import * as Brightness from 'expo-brightness';
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import * as Haptics from 'expo-haptics';
import { useKeepAwake } from 'expo-keep-awake';
import * as SecureStore from 'expo-secure-store';
import { useIsFocused } from 'expo-router';
import { SymbolView, type SFSymbol } from 'expo-symbols';
import type { HassEntity } from 'home-assistant-js-websocket';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Alert, Image, Modal, Pressable, ScrollView, StyleSheet, Switch, Text, useWindowDimensions, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { removeAutomation, setSnapshots, SNAPSHOTS_ID, useAutomation } from '@/automations';
import { degrees, roomReadings } from '@/climate';
import { active as isActive, allDevices, domainOf, ICONS, useDevice } from '@/components/device-tile';
import { DeviceSheet } from '@/components/device-sheet';
import { HalloweenBoard, useHalloweenBoard } from '@/components/halloween';
import { ThermostatCard } from '@/components/thermostat';
import { sky, useForecast, WeatherSheet } from '@/components/weather';
import { LiveTile } from '@/components/live-grid';
import { LiveView } from '@/components/live-view';
import { Card } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { useFavourites } from '@/favourites';
import { byDomain, name, scenesOf, unavailable, useHA } from '@/ha';
import { useIconMotion } from '@/components/icon-motion';
import { isPad } from '@/orientation';
import { runScene } from '@/scenes';

const GAP = 14;
const PAD = 24;
const IDLE_MS = 3 * 60_000;
// ponytail: fixed night hours (11 PM–7 AM); make them a setting if they ever need to change.
const NIGHT_FROM = 23;
const NIGHT_TO = 7;
const NIGHT_IDLE_MS = 30_000;
const LIVE_MS = 2 * 60_000; // Live on the camera page stops after this (Blink cameras run on batteries)
const GLASS = isLiquidGlassAvailable();

// Home Assistant's weather conditions.

// The wall dashboard is for the iPad: there it replaces Home unless turned off in Settings. The phone never shows it.
const WALL_KEY = 'wall-dashboard';
let wallOn = isPad;
const wallListeners = new Set<(on: boolean) => void>();
const wallLoaded = isPad ? SecureStore.getItemAsync(WALL_KEY).then((v) => (wallOn = v !== 'off')) : Promise.resolve(false);

/** Whether Home shows the wall dashboard (iPad only), and a setter for the Settings switch. */
export function useWallDashboard() {
  const [on, setOn] = useState(wallOn);
  useEffect(() => {
    wallListeners.add(setOn);
    wallLoaded.then(setOn);
    return () => void wallListeners.delete(setOn);
  }, []);
  const set = (next: boolean) => {
    wallOn = next;
    wallListeners.forEach((l) => l(next));
    SecureStore.setItemAsync(WALL_KEY, next ? 'on' : 'off');
  };
  return [isPad && on, set] as const;
}

/** The Settings switch for it, shown only on an iPad. */
export function WallSetting() {
  const [on, set] = useWallDashboard();
  if (!isPad) return null;
  return (
    <Card>
      <View style={styles.between}>
        <ThemedText type="smallBold">Wall dashboard</ThemedText>
        <Switch value={on} onValueChange={set} accessibilityLabel="Wall dashboard" />
      </View>
      <ThemedText type="small" themeColor="textSecondary">
        For an iPad on the wall: Home shows glass tiles, a clock, the weather and cameras, keeps the screen on and fades
        to a clock when nobody touches it. Off, Home is the same list as on your iPhone.
      </ThemedText>
    </Card>
  );
}

const time = (d: Date) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

export function greeting() {
  const h = new Date().getHours();
  return h < 5 ? 'Good night' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

/** Which cameras play in place (by slug); all stop when `active` goes false (page swiped away, covered, idle). */
function useInlineLive(active: boolean) {
  const [live, setLive] = useState<string[]>([]);
  if (live.length && !active) setLive([]);
  const play = useCallback((slug: string, on: boolean) => setLive((l) => (on ? [...l.filter((x) => x !== slug), slug] : l.filter((x) => x !== slug))), []);
  return [live, play, setLive] as const;
}

/**
 * The iPad's Home, made to hang on a wall: time and weather, a clock, cameras, scenes and devices as glass tiles (your
 * favourites, or everything until you pick some). Tap a device to switch it, hold it for its settings. Swipe left for
 * every camera's snapshot, with a Live button. A doorbell press opens that camera live. The screen stays on while this is showing; after 3 minutes
 * untouched it fades to a big clock, and a tap brings the dashboard back.
 */
export function Wall() {
  const { creds, entities, devices: registry, areas, status, call } = useHA();
  const { favourites } = useFavourites();
  const { width, height } = useWindowDimensions();
  const focused = useIsFocused();
  const [detail, setDetail] = useState<string>();
  const [watch, setWatch] = useState<HassEntity>();
  const [page, setPage] = useState(0);
  const night = useNight();
  const halloween = useHalloweenBoard();
  // Halloween night stays on the board (setTimeout's longest wait is about 24 days).
  const [idle, poke] = useIdle(halloween ? 2 ** 31 - 1 : night ? NIGHT_IDLE_MS : IDLE_MS);
  const pager = useRef<ScrollView>(null);
  const [live, play] = useInlineLive(page === 0 && focused && !idle && !watch && !detail);

  useDoorbell((camera) => {
    poke();
    setWatch(camera);
  });

  const allCameras = byDomain(entities, 'camera').filter((e) => e.attributes.snapshot_of);
  const pinned = (favourites ?? []).flatMap((id) => (entities[id] ? [entities[id]] : []));
  const isScene = (e: HassEntity) => ['scene', 'script'].includes(domainOf(e));
  const none = !pinned.length;
  const cameras = none ? allCameras : pinned.filter((e) => e.attributes.snapshot_of);
  const scenes = none ? scenesOf(entities) : pinned.filter(isScene);
  const alarms = byDomain(entities, 'alarm_control_panel');
  const thermostat = byDomain(entities, 'climate')[0];
  const devices = (none ? allDevices(entities, registry) : pinned.filter((e) => !e.attributes.snapshot_of && !isScene(e))).filter((e) => e !== thermostat);
  const rooms = Object.entries(roomReadings(entities, registry, areas))
    .filter(([, r]) => r.temperature !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));
  const on = allDevices(entities, registry).filter(isActive);
  const summary = [
    on.length ? `${on.length} on` : 'Everything is off',
    thermostat && !unavailable(thermostat) && `${degrees(thermostat.attributes.current_temperature)} inside`,
    ...alarms.filter((a) => !unavailable(a)).map((a) => (a.state.startsWith('arm') ? 'Armed' : 'Disarmed')),
  ].filter(Boolean);

  // Five columns across (four standing up); the time and weather take two by two, the rest flow around them.
  const landscape = width > height;
  const cols = landscape ? 5 : 4;
  const byWidth = (width - PAD * 2 - GAP * (cols - 1)) / cols;
  const cell = Math.floor(landscape ? Math.min(byWidth, (height - 220 - GAP * 2) / 3) : byWidth);
  const span = (n: number) => cell * n + GAP * (n - 1);
  const tiles = [
    ...(thermostat ? [<ThermostatCard key="thermostat" entity={thermostat} width={span(2)} height={cell} onPress={() => setDetail(thermostat.entity_id)} />] : []),
    <ClockTile key="clock" size={cell} />,
    ...alarms.map((a) => <SecurityTile key={a.entity_id} alarm={a} size={cell} />),
    ...(!thermostat && rooms.length > 1 ? [<RoomsTile key="rooms" rooms={rooms} size={cell} />] : []),
    ...cameras.map((c) => (
      <CameraTile
        key={c.entity_id}
        camera={c}
        width={cell}
        height={cell}
        live={live.includes(c.attributes.snapshot_of)}
        onLive={play}
        onOpen={() => setWatch(c)}
      />
    )),
    ...scenes.map((s) => <SceneTile key={s.entity_id} scene={s} size={cell} />),
    ...devices.map((d) => <DeviceTile key={d.entity_id} entity={d} size={cell} onLongPress={() => setDetail(d.entity_id)} />),
  ];
  // As many tiles as fill the two rows beside the weather (the thermostat is two wide).
  let room = (cols - 2) * 2;
  const beside = tiles.findIndex((t) => (room -= t.key === 'thermostat' ? 2 : 1) < 0);
  const goTo = (i: number) => {
    pager.current?.scrollTo({ x: i * width });
    setPage(i);
  };
  const backdrop = allCameras[0]?.attributes.entity_picture;
  const close = (then: () => void) => () => {
    then();
    poke();
  };

  return (
    <View style={styles.wall} onStartShouldSetResponderCapture={() => (poke(), false)}>
      {creds && backdrop && <Image source={{ uri: creds.url + backdrop }} blurRadius={60} style={StyleSheet.absoluteFill} />}
      <View style={styles.dim} />
      <Streaks width={width} height={height} />
      <SafeAreaView style={styles.flex} edges={['top']}>
        <ScrollView
          ref={pager}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={(e) => setPage(Math.round(e.nativeEvent.contentOffset.x / width))}>
          <ScrollView style={{ width }} contentContainerStyle={[styles.page, { width: span(cols) + PAD * 2 }]}>
            <View style={styles.between}>
              <View style={styles.flex}>
                <Text style={styles.heading}>{greeting()}</Text>
                {status === 'ready' ? (
                  <Text style={styles.sub} numberOfLines={1}>{summary.join(' · ')}</Text>
                ) : (
                  <Text style={styles.banner}>{status === 'connecting' ? 'Connecting…' : 'Hub offline · reconnecting'}</Text>
                )}
              </View>
              {on.length > 0 && (
                <Pill icon="power" label="All off" on={false} onPress={() => call('homeassistant', 'turn_off', { entity_id: on.map((e) => e.entity_id) })} />
              )}
            </View>
            {halloween && <HalloweenBoard width={span(cols)} height={cell} />}
            <View style={styles.row}>
              <WeatherTile size={span(2)} />
              <View style={[styles.flow, { width: span(cols - 2) }]}>{beside < 0 ? tiles : tiles.slice(0, beside)}</View>
            </View>
            {beside >= 0 && <View style={styles.flow}>{tiles.slice(beside)}</View>}
          </ScrollView>
          <CameraPage cameras={allCameras} width={width} active={page === 1 && focused && !idle && !watch && !detail} onWatch={setWatch} />
        </ScrollView>
        <View style={styles.dots}>
          {['Home', 'Cameras'].map((label, i) => (
            <Pressable
              key={label}
              accessibilityRole="tab"
              accessibilityLabel={label}
              accessibilityState={{ selected: page === i }}
              hitSlop={12}
              onPress={() => goTo(i)}
              style={[styles.pageDot, page === i && styles.pageDotOn]}
            />
          ))}
        </View>
      </SafeAreaView>

      {focused && <KeepAwake />}
      <Modal
        visible={idle && focused && !watch && !detail}
        animationType="fade"
        backdropColor="#000"
        supportedOrientations={['portrait', 'landscape']}
        onRequestClose={poke}>
        <ScreenSaver size={Math.min(width, height) * 0.6} night={night} onWake={poke} />
      </Modal>

      {creds && watch && (
        <LiveView
          creds={creds}
          slug={watch.attributes.snapshot_of}
          title={name(watch)}
          ptt={liveCamera(entities, watch)?.attributes.ptt_supported !== false}
          onClose={close(() => setWatch(undefined))}
        />
      )}
      {detail && entities[detail] && <DeviceSheet entity={entities[detail]} onClose={close(() => setDetail(undefined))} />}
    </View>
  );
}

function KeepAwake() {
  useKeepAwake();
  return null;
}

/** Faint diagonal light across the background, for the glass to catch. */
function Streaks({ width, height }: { width: number; height: number }) {
  const long = Math.hypot(width, height);
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {[0.18, 0.42, 0.47, 0.76].map((at, i) => (
        <View
          key={at}
          style={{
            position: 'absolute',
            left: width * at - long / 2,
            top: height / 2,
            width: long,
            height: i === 2 ? 14 : 1.5,
            backgroundColor: `rgba(255,255,255,${i === 2 ? 0.04 : 0.09})`,
            transform: [{ rotate: '-55deg' }],
          }}
        />
      ))}
    </View>
  );
}

const liveCamera = (entities: Record<string, HassEntity>, camera: HassEntity) =>
  Object.values(entities).find((e) => e.entity_id.startsWith('camera.') && e.attributes.proxy_slug === camera.attributes.snapshot_of);

/** True once nothing has touched the screen for `ms`; `poke` starts the wait again. */
function useIdle(ms: number) {
  const [idle, setIdle] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const poke = useCallback(() => {
    setIdle(false);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setIdle(true), ms);
  }, [ms]);
  useEffect(() => {
    timer.current = setTimeout(() => setIdle(true), ms);
    return () => clearTimeout(timer.current);
  }, [ms]);
  return [idle, poke] as const;
}

/**
 * Calls `ring` with the doorbell's camera when Blink Instant Events reports a press. Its event entity's state is the
 * time of the camera's last event; `event_type` says which.
 */
function useDoorbell(ring: (camera: HassEntity) => void) {
  const { entities, devices } = useHA();
  const seen = useRef<Record<string, string>>({});
  useEffect(() => {
    for (const e of Object.values(entities)) {
      if (!e.entity_id.startsWith('event.') || !e.attributes.event_types?.includes('doorbell_press')) continue;
      const was = seen.current[e.entity_id];
      seen.current[e.entity_id] = e.state;
      if (was === undefined || was === e.state || e.attributes.event_type !== 'doorbell_press') continue;
      const cameras = Object.values(entities).filter((c) => c.attributes.snapshot_of);
      const camera =
        cameras.find((c) => devices[c.entity_id] && devices[c.entity_id].id === devices[e.entity_id]?.id) ??
        cameras.find((c) => liveCamera(entities, c)?.attributes.camera_type === 'doorbell');
      if (camera) ring(camera);
    }
  });
}

function useNow() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

function Glass({ width, height = width, on, center, label, hint, onPress, onLongPress, children }: {
  width: number;
  height?: number;
  on?: boolean;
  center?: boolean;
  label: string;
  hint?: string;
  onPress?: () => void;
  onLongPress?: () => void;
  children: ReactNode;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityState={on === undefined ? undefined : { selected: on }}
      disabled={!onPress && !onLongPress}
      onPress={onPress}
      onLongPress={onLongPress}
      style={({ pressed }) => [{ width, height }, pressed && styles.pressed]}>
      <GlassView
        glassEffectStyle="regular"
        colorScheme="dark"
        tintColor={on ? 'rgba(255,255,255,0.88)' : undefined}
        style={[styles.glass, center && styles.center, !GLASS && { backgroundColor: on ? '#f2f2f7' : 'rgba(255,255,255,0.1)' }]}>
        {children}
      </GlassView>
    </Pressable>
  );
}

function Label({ title, sub, dark }: { title: string; sub?: string; dark?: boolean }) {
  return (
    <View>
      <Text style={[styles.title, styles.centered, dark && styles.ink]} numberOfLines={2}>
        {title}
      </Text>
      {sub && (
        <Text style={[styles.sub, styles.centered, dark && styles.inkSub]} numberOfLines={1}>
          {sub}
        </Text>
      )}
    </View>
  );
}

function WeatherTile({ size }: { size: number }) {
  const { conn, entities } = useHA();
  const now = useNow();
  const [open, setOpen] = useState(false);
  const weather = byDomain(entities, 'weather')[0];
  const today = useForecast(conn, weather?.entity_id, 'daily')[0];
  const hours = useForecast(conn, weather?.entity_id, 'hourly').slice(1, 6);
  const [label, icon] = sky(weather?.state);
  const temp = weather?.attributes.temperature;
  const round = (n?: number) => (n === undefined ? '–' : Math.round(n));
  const date = now.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
  return (
    <Glass
      width={size}
      label={temp === undefined ? `${time(now)}, ${date}` : `${round(temp)} degrees, ${label}`}
      hint={weather ? 'Shows today’s weather' : undefined}
      onPress={weather ? () => setOpen(true) : undefined}>
      <View style={styles.between}>
        <Text style={styles.small}>{time(now)}</Text>
        <Text style={styles.small}>{date}</Text>
      </View>
      {temp === undefined ? (
        <Text style={[styles.big, { fontSize: size * 0.22 }]}>{time(now)}</Text>
      ) : (
        <View>
          <View style={styles.between}>
            <Text style={[styles.big, { fontSize: size * 0.26 }]}>{round(temp)}°</Text>
            <SymbolView name={icon} size={size * 0.16} type="multicolor" />
          </View>
          <Text style={styles.title}>{label}</Text>
          {today && (
            <Text style={styles.sub}>
              H: {round(today.temperature)}°   L: {round(today.templow)}°
              {today.precipitation_probability !== undefined ? `   ☂ ${today.precipitation_probability}%` : ''}
            </Text>
          )}
        </View>
      )}
      {hours.length > 0 && (
        <View style={styles.weatherHours}>
          {hours.map((h) => (
            <View key={h.datetime} style={styles.weatherHour}>
              <Text style={styles.sub}>{new Date(h.datetime).toLocaleTimeString([], { hour: 'numeric' })}</Text>
              <SymbolView name={sky(h.condition)[1]} size={20} type="multicolor" />
              <Text style={styles.title}>{round(h.temperature)}°</Text>
            </View>
          ))}
        </View>
      )}
      {open && <WeatherSheet onClose={() => setOpen(false)} />}
    </Glass>
  );
}

function ClockTile({ size }: { size: number }) {
  return (
    <Glass width={size} center label="Clock">
      <AnalogClock size={size - 36} />
    </Glass>
  );
}

/** A clock face drawn with views: twelve ticks and three hands, each a bar turned about the centre. */
function AnalogClock({ size, dark }: { size: number; dark?: boolean }) {
  const now = useNow();
  const s = now.getSeconds();
  const m = now.getMinutes() + s / 60;
  const h = (now.getHours() % 12) + m / 60;
  const ink = dark ? '#fff' : '#1c1c1e';
  const turn = (deg: number, top: number, length: number, w: number, color: string, key?: number) => (
    <View key={key} pointerEvents="none" style={[StyleSheet.absoluteFill, { transform: [{ rotate: `${deg}deg` }] }]}>
      <View style={{ position: 'absolute', top, left: (size - w) / 2, width: w, height: length, borderRadius: w / 2, backgroundColor: color }} />
    </View>
  );
  return (
    <View
      accessible
      accessibilityLabel={time(now)}
      style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: dark ? '#111' : '#f5f5f7' }}>
      {Array.from({ length: 12 }, (_, i) =>
        turn(i * 30, size * 0.05, size * (i % 3 ? 0.05 : 0.09), i % 3 ? size * 0.012 : size * 0.025, ink, i),
      )}
      {turn(h * 30, size * 0.24, size * 0.28, size * 0.04, ink)}
      {turn(m * 6, size * 0.15, size * 0.37, size * 0.028, ink)}
      {turn(s * 6, size * 0.08, size * 0.5, Math.max(1.5, size * 0.008), '#FF3B30')}
      <View style={[styles.hub, { left: size / 2 - size * 0.025, top: size / 2 - size * 0.025, width: size * 0.05, height: size * 0.05, borderRadius: size }]} />
    </View>
  );
}

function ScreenSaver({ size, night, onWake }: { size: number; night: boolean; onWake: () => void }) {
  const now = useNow();
  // Drift a little each minute so nothing stays burned into the same pixels.
  const drift = ((now.getMinutes() % 7) - 3) * 8;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel="Show the dashboard" onPress={onWake} style={styles.saver}>
      {night && <DimScreen />}
      <View style={{ transform: [{ translateX: drift }, { translateY: -drift }], alignItems: 'center', gap: 24, opacity: night ? 0.35 : 1 }}>
        <AnalogClock size={size} dark />
        <Text style={styles.saverDate}>{now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}</Text>
      </View>
    </Pressable>
  );
}

const isNight = () => {
  const h = new Date().getHours();
  return h >= NIGHT_FROM || h < NIGHT_TO;
};

/** Night hours: the dashboard goes to its clock after 30 seconds instead of 3 minutes, and the clock is dim. */
function useNight() {
  const [night, setNight] = useState(isNight);
  useEffect(() => {
    const t = setInterval(() => setNight(isNight()), 60_000);
    return () => clearInterval(t);
  }, []);
  return night;
}

/**
 * The screen almost dark while it's showing; back to where it was when it goes (a tap, or the doorbell opening the
 * camera). iOS also puts it back if the iPad locks.
 */
function DimScreen() {
  useEffect(() => {
    let gone = false;
    let before: number | undefined;
    Brightness.getBrightnessAsync()
      .then((b) => {
        if (gone) return;
        before = b;
        return Brightness.setBrightnessAsync(0.02);
      })
      .catch(() => {});
    return () => {
      gone = true;
      if (before !== undefined) Brightness.setBrightnessAsync(before).catch(() => {});
    };
  }, []);
  return null;
}

function SceneTile({ scene, size }: { scene: HassEntity; size: number }) {
  const { conn } = useHA();
  const [running, setRunning] = useState(false);
  const run = () => {
    if (!conn) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setRunning(true);
    runScene(conn, scene.entity_id)
      .catch((e) => Alert.alert('Scene failed', e?.message ?? String(e)))
      .finally(() => setRunning(false));
  };
  return (
    <Glass width={size} on={running} center label={`${name(scene)} scene`} onPress={run}>
      <SymbolView name={ICONS[domainOf(scene)]} size={size * 0.2} tintColor={running ? '#1c1c1e' : '#fff'} />
      <Label title={name(scene)} sub="Scene" dark={running} />
    </Glass>
  );
}

/** A device to tap on or off; a thermostat shows the room's temperature instead, and a tap opens its controls. */
function DeviceTile({ entity, size, onLongPress }: { entity: HassEntity; size: number; onLongPress: () => void }) {
  const { off, isOn, state, timer, rgb: [r, g, b], icon, toggle } = useDevice(entity);
  const reading = domainOf(entity) === 'climate' ? (entity.attributes.current_temperature as number | undefined) : undefined;
  return (
    <Glass
      width={size}
      on={isOn}
      label={`${name(entity)}, ${reading !== undefined ? `${degrees(reading)}, ` : ''}${state}${timer}`}
      hint={toggle ? 'Hold for timers, schedules and settings' : 'Opens its controls'}
      onPress={off ? undefined : (toggle ?? onLongPress)}
      onLongPress={onLongPress}
      center>
      {reading !== undefined ? (
        <Text style={[styles.reading, { fontSize: size * 0.22 }, isOn && { color: `rgb(${r},${g},${b})` }]}>{degrees(reading)}</Text>
      ) : (
        <DeviceIcon entity={entity} isOn={isOn} icon={icon} rgb={[r, g, b]} size={size * 0.2} dim={off} />
      )}
      <Label title={name(entity)} sub={state + timer} dark={isOn} />
    </Glass>
  );
}

/**
 * A device's icon, moving the way it does (src/components/icon-motion.ts): a fan spins, a TV flickers, a speaker beats,
 * a light glows in its own colour. Switching gives it a little pop. Still with Reduce Motion on.
 */
function DeviceIcon({ entity, isOn, icon, rgb: [r, g, b], size, dim }: {
  entity: HassEntity;
  isOn: boolean;
  icon: SFSymbol;
  rgb: number[];
  size: number;
  dim: boolean;
}) {
  const still = useReducedMotion();
  const { kind, style: motion, loop } = useIconMotion(icon, entity, isOn);
  const pop = useSharedValue(1);
  const glow = useSharedValue(isOn ? 1 : 0);
  const was = useRef(isOn);

  useEffect(() => {
    glow.set(withTiming(isOn ? 1 : 0, { duration: 400 }));
    if (was.current !== isOn && !still) pop.set(withSequence(withTiming(1.25, { duration: 120 }), withSpring(1)));
    was.current = isOn;
  }, [isOn, still, glow, pop]);

  const popped = useAnimatedStyle(() => ({ transform: [{ scale: pop.value }] }));
  // A TV's halo flickers with its screen.
  const halo = useAnimatedStyle(() => ({ opacity: glow.value * (kind === 'flicker' ? 0.3 + 0.5 * loop.value : 1) }));
  const brightness = (entity.attributes.brightness ?? 255) / 255;
  return (
    <View style={{ width: size * 1.4, height: size * 1.4, alignItems: 'center', justifyContent: 'center' }}>
      {(kind === 'glow' || kind === 'flicker') && (
        <Animated.View
          style={[
            styles.halo,
            {
              width: size * 1.6,
              height: size * 1.6,
              borderRadius: size,
              backgroundColor: `rgba(${r},${g},${b},${0.15 + brightness * 0.25})`,
              shadowColor: `rgb(${r},${g},${b})`,
              shadowRadius: size * 0.6,
            },
            halo,
          ]}
        />
      )}
      <Animated.View style={popped}>
        <Animated.View style={motion}>
          <SymbolView name={icon} size={size} tintColor={isOn ? `rgb(${r},${g},${b})` : dim ? '#ffffff55' : '#fff'} />
        </Animated.View>
      </Animated.View>
    </View>
  );
}

/**
 * A camera's snapshot. ▶ plays it right here (muted, stops after 2 minutes); tapping the picture, or the playing video,
 * opens it full screen with sound and talk.
 */
function CameraTile({ camera, width, height, live, onLive, onOpen }: {
  camera: HassEntity;
  width: number;
  height: number;
  live: boolean;
  onLive: (slug: string, on: boolean) => void;
  onOpen: () => void;
}) {
  const { creds, entities } = useHA();
  const slug: string = camera.attributes.snapshot_of;
  const motion = entities[`binary_sensor.${camera.entity_id.split('.')[1]}_motion`]?.state === 'on';
  const picture: string | undefined = camera.attributes.entity_picture;
  useEffect(() => {
    if (!live) return;
    const t = setTimeout(() => onLive(slug, false), LIVE_MS);
    return () => clearTimeout(t);
  }, [live, slug, onLive]);

  return (
    <View style={[styles.camera, { width, height }]}>
      {creds && live ? (
        <LiveTile creds={creds} camera={{ slug, name: name(camera) }} width={width} height={height} hidden={false} focused={false} onPress={onOpen} />
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${name(camera)}, open live full screen`}
          onPress={onOpen}
          style={({ pressed }) => [StyleSheet.absoluteFill, pressed && styles.pressed]}>
          {creds && picture && <Image source={{ uri: creds.url + picture }} style={StyleSheet.absoluteFill} />}
          <View style={styles.cameraLabel}>
            {motion && <View style={styles.dot} />}
            <Text style={styles.cameraName} numberOfLines={1}>
              {name(camera)}
            </Text>
          </View>
        </Pressable>
      )}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={live ? `Stop ${name(camera)}` : `Play ${name(camera)} here`}
        hitSlop={10}
        onPress={() => onLive(slug, !live)}
        style={({ pressed }) => [styles.playButton, pressed && styles.pressed]}>
        <SymbolView name={live ? 'stop.fill' : 'play.fill'} size={16} tintColor="#fff" />
      </Pressable>
    </View>
  );
}

/**
 * Every camera's snapshot, each with its own ▶; "Play all" starts them together. Playing stops after 2 minutes, or when
 * the page is swiped away or covered. "7 AM and 7 PM" keeps the snapshots fresh with a Home Assistant automation.
 */
function CameraPage({ cameras, width, active, onWatch }: {
  cameras: HassEntity[];
  width: number;
  active: boolean;
  onWatch: (camera: HassEntity) => void;
}) {
  const { creds } = useHA();
  const [live, play, setLive] = useInlineLive(active);
  const all = cameras.length > 0 && cameras.every((c) => live.includes(c.attributes.snapshot_of));
  const refreshing = !!useAutomation(SNAPSHOTS_ID);
  const cols = width > 900 ? 3 : 2;
  const w = Math.floor((width - PAD * 2 - GAP * (cols - 1)) / cols);
  const toggleSnapshots = () =>
    creds &&
    (refreshing ? removeAutomation(creds, SNAPSHOTS_ID) : setSnapshots(creds)).catch((e) =>
      Alert.alert('Couldn’t change camera snapshots', e?.message ?? String(e)),
    );
  return (
    <ScrollView style={{ width }} contentContainerStyle={styles.page}>
      <View style={styles.between}>
        <Text style={styles.heading}>Cameras</Text>
        <View style={styles.row}>
          <Pill icon={refreshing ? 'checkmark.circle.fill' : 'clock'} label="New snapshot at 7 AM and 7 PM" on={refreshing} onPress={toggleSnapshots} />
          <Pill
            icon={all ? 'stop.fill' : 'play.fill'}
            label={all ? 'Stop all' : 'Play all'}
            on={all}
            onPress={() => setLive(all ? [] : cameras.map((c) => c.attributes.snapshot_of))}
          />
        </View>
      </View>
      <View style={styles.flow}>
        {cameras.map((c) => (
          <CameraTile
            key={c.entity_id}
            camera={c}
            width={w}
            height={Math.round((w * 9) / 16)}
            live={live.includes(c.attributes.snapshot_of)}
            onLive={play}
            onOpen={() => onWatch(c)}
          />
        ))}
      </View>
    </ScrollView>
  );
}

function Pill({ icon, label, on, onPress }: { icon: SFSymbol; label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
      onPress={onPress}
      style={({ pressed }) => [styles.pill, on && styles.pillOn, pressed && styles.pressed]}>
      <SymbolView name={icon} size={14} tintColor={on ? '#1c1c1e' : '#fff'} />
      <Text style={[styles.pillText, on && styles.ink]}>{label}</Text>
    </Pressable>
  );
}

/** The alarm: tap to arm (away) or disarm. */
function SecurityTile({ alarm, size }: { alarm: HassEntity; size: number }) {
  const { call } = useHA();
  const off = unavailable(alarm);
  const armed = alarm.state.startsWith('arm'); // 'arming' too, so it doesn't flick back
  const status = off ? 'Unavailable' : alarm.state === 'arming' ? 'Arming…' : armed ? 'Armed' : 'Disarmed';
  const flip = () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    call('alarm_control_panel', armed ? 'alarm_disarm' : 'alarm_arm_away', { entity_id: alarm.entity_id });
  };
  return (
    <Glass width={size} on={armed} center label={`${name(alarm)}, ${status}`} hint={armed ? 'Disarms' : 'Arms'} onPress={off ? undefined : flip}>
      <SymbolView name={armed ? 'lock.shield.fill' : 'shield'} size={size * 0.2} tintColor={armed ? '#1c1c1e' : off ? '#ffffff55' : '#fff'} />
      <Label title={name(alarm)} sub={status} dark={armed} />
    </Glass>
  );
}

/** Each room's temperature, and a green dot where someone is (when there's no thermostat to show them). */
function RoomsTile({ rooms, size }: { rooms: [string, { temperature?: number; occupied?: boolean }][]; size: number }) {
  return (
    <Glass width={size} label={`Rooms: ${rooms.map(([room, r]) => `${room} ${degrees(r.temperature)}`).join(', ')}`}>
      <Text style={styles.small}>Rooms</Text>
      <View style={styles.rooms}>
        {rooms.slice(0, 5).map(([room, r]) => (
          <View key={room} style={styles.roomRow}>
            <Text style={styles.roomName} numberOfLines={1}>{room}</Text>
            {r.occupied && <View style={[styles.dot, styles.here]} />}
            <Text style={styles.roomTemp}>{degrees(r.temperature)}</Text>
          </View>
        ))}
      </View>
    </Glass>
  );
}

const styles = StyleSheet.create({
  wall: { flex: 1, backgroundColor: '#0b0b0f' },
  flex: { flex: 1 },
  dim: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.55)' },
  page: { padding: PAD, gap: GAP, alignSelf: 'center' },
  row: { flexDirection: 'row', gap: GAP },
  flow: { flexDirection: 'row', flexWrap: 'wrap', gap: GAP, alignContent: 'flex-start' },
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  glass: { flex: 1, borderRadius: 28, padding: 18, overflow: 'hidden', justifyContent: 'space-between' },
  center: { alignItems: 'center', justifyContent: 'center', gap: 10 },
  title: { color: '#fff', fontSize: 16, fontWeight: '600' },
  sub: { color: 'rgba(255,255,255,0.65)', fontSize: 13, marginTop: 2 },
  centered: { textAlign: 'center' },
  ink: { color: '#1c1c1e' },
  inkSub: { color: 'rgba(28,28,30,0.6)' },
  small: { color: 'rgba(255,255,255,0.8)', fontSize: 15, fontWeight: '600' },
  big: { color: '#fff', fontWeight: '300', letterSpacing: -2, fontVariant: ['tabular-nums'] },
  weatherHours: { flexDirection: 'row', justifyContent: 'space-between', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(255,255,255,0.25)', paddingTop: 10 },
  weatherHour: { alignItems: 'center', gap: 6 },
  heading: { color: '#fff', fontSize: 28, fontWeight: '700' },
  banner: { color: '#FF9F0A', fontSize: 15, fontWeight: '600' },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.14)' },
  pillOn: { backgroundColor: '#f2f2f7' },
  pillText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  halo: { position: 'absolute', shadowOpacity: 1, shadowOffset: { width: 0, height: 0 } },
  camera: { borderRadius: 28, overflow: 'hidden', backgroundColor: '#1c1c1e' },
  playButton: {
    position: 'absolute',
    right: 10,
    bottom: 10,
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  reading: { color: '#fff', fontWeight: '300', letterSpacing: -1, fontVariant: ['tabular-nums'] },
  rooms: { gap: 6 },
  roomRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  roomName: { flex: 1, color: 'rgba(255,255,255,0.85)', fontSize: 14, fontWeight: '500' },
  roomTemp: { color: '#fff', fontSize: 15, fontWeight: '600', fontVariant: ['tabular-nums'] },
  here: { backgroundColor: '#30D158' },
  dots: { position: 'absolute', bottom: 28, alignSelf: 'center', flexDirection: 'row', gap: 10 },
  pageDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.3)' },
  pageDotOn: { backgroundColor: '#fff' },
  cameraLabel: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    padding: 14,
    paddingRight: 56, // the ▶ button
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  cameraName: { flex: 1, color: '#fff', fontSize: 15, fontWeight: '700' },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#FF3B30' },
  hub: { position: 'absolute', backgroundColor: '#FF3B30' },
  saver: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#000' },
  saverDate: { color: 'rgba(255,255,255,0.7)', fontSize: 28, fontWeight: '500' },
  pressed: { opacity: 0.7 },
});
