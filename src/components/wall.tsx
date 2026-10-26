import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import * as Haptics from 'expo-haptics';
import { useKeepAwake } from 'expo-keep-awake';
import { useIsFocused } from 'expo-router';
import { SymbolView, type SFSymbol } from 'expo-symbols';
import type { Connection, HassEntity } from 'home-assistant-js-websocket';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Alert, Image, Modal, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { removeAutomation, setSnapshots, SNAPSHOTS_ID, useAutomation } from '@/automations';
import { allDevices, domainOf, ICONS, useDevice } from '@/components/device-tile';
import { DeviceSheet } from '@/components/device-sheet';
import { LiveTile } from '@/components/live-grid';
import { LiveView } from '@/components/live-view';
import { useFavourites } from '@/favourites';
import { byDomain, name, useHA } from '@/ha';
import { runScene } from '@/scenes';

const GAP = 14;
const PAD = 24;
const IDLE_MS = 3 * 60_000;
const LIVE_MS = 2 * 60_000; // Live on the camera page stops after this (Blink cameras run on batteries)
const GLASS = isLiquidGlassAvailable();

// Home Assistant's weather conditions.
const SKY: Record<string, [string, SFSymbol]> = {
  sunny: ['Sunny', 'sun.max.fill'],
  'clear-night': ['Clear', 'moon.stars.fill'],
  partlycloudy: ['Partly cloudy', 'cloud.sun.fill'],
  cloudy: ['Cloudy', 'cloud.fill'],
  fog: ['Fog', 'cloud.fog.fill'],
  rainy: ['Rain', 'cloud.rain.fill'],
  pouring: ['Heavy rain', 'cloud.heavyrain.fill'],
  snowy: ['Snow', 'cloud.snow.fill'],
  'snowy-rainy': ['Sleet', 'cloud.sleet.fill'],
  hail: ['Hail', 'cloud.hail.fill'],
  lightning: ['Thunder', 'cloud.bolt.fill'],
  'lightning-rainy': ['Thunderstorm', 'cloud.bolt.rain.fill'],
  windy: ['Windy', 'wind'],
  'windy-variant': ['Windy', 'wind'],
};

const time = (d: Date) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

/**
 * The iPad's Home, made to hang on a wall: time and weather, a clock, cameras, scenes and devices as glass tiles (your
 * favourites, or everything until you pick some). Tap a device to switch it, hold it for its settings. Swipe left for
 * every camera's snapshot, with a Live button. A doorbell press opens that camera live. The screen stays on while this is showing; after 3 minutes
 * untouched it fades to a big clock, and a tap brings the dashboard back.
 */
export function Wall() {
  const { creds, entities, devices: registry, status } = useHA();
  const { favourites } = useFavourites();
  const { width, height } = useWindowDimensions();
  const focused = useIsFocused();
  const [detail, setDetail] = useState<string>();
  const [watch, setWatch] = useState<HassEntity>();
  const [page, setPage] = useState(0);
  const [idle, poke] = useIdle(IDLE_MS);

  useDoorbell((camera) => {
    poke();
    setWatch(camera);
  });

  const allCameras = byDomain(entities, 'camera').filter((e) => e.attributes.snapshot_of);
  const pinned = (favourites ?? []).flatMap((id) => (entities[id] ? [entities[id]] : []));
  const isScene = (e: HassEntity) => ['scene', 'script'].includes(domainOf(e));
  const none = !pinned.length;
  const cameras = none ? allCameras : pinned.filter((e) => e.attributes.snapshot_of);
  const scenes = none ? byDomain(entities, 'scene', 'script') : pinned.filter(isScene);
  const devices = none ? allDevices(entities, registry) : pinned.filter((e) => !e.attributes.snapshot_of && !isScene(e));

  // Five columns across (four standing up); the time and weather take two by two, the rest flow around them.
  const landscape = width > height;
  const cols = landscape ? 5 : 4;
  const byWidth = (width - PAD * 2 - GAP * (cols - 1)) / cols;
  const cell = Math.floor(landscape ? Math.min(byWidth, (height - 170 - GAP * 2) / 3) : byWidth);
  const span = (n: number) => cell * n + GAP * (n - 1);
  const tiles = [
    <ClockTile key="clock" size={cell} />,
    ...cameras.map((c) => <CameraTile key={c.entity_id} camera={c} width={cell} height={cell} onPress={() => setWatch(c)} />),
    ...scenes.map((s) => <SceneTile key={s.entity_id} scene={s} size={cell} />),
    ...devices.map((d) => <DeviceTile key={d.entity_id} entity={d} size={cell} onLongPress={() => setDetail(d.entity_id)} />),
  ];
  const beside = (cols - 2) * 2;
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
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={(e) => setPage(Math.round(e.nativeEvent.contentOffset.x / width))}>
          <ScrollView style={{ width }} contentContainerStyle={[styles.page, { width: span(cols) + PAD * 2 }]}>
            {status !== 'ready' && <Text style={styles.banner}>{status === 'connecting' ? 'Connecting…' : 'Hub offline · reconnecting'}</Text>}
            <View style={styles.row}>
              <WeatherTile size={span(2)} />
              <View style={[styles.flow, { width: span(cols - 2) }]}>{tiles.slice(0, beside)}</View>
            </View>
            <View style={styles.flow}>{tiles.slice(beside)}</View>
          </ScrollView>
          <CameraPage cameras={allCameras} width={width} active={page === 1 && focused && !idle && !watch && !detail} onWatch={setWatch} />
        </ScrollView>
      </SafeAreaView>

      {focused && <KeepAwake />}
      <Modal
        visible={idle && focused && !watch && !detail}
        animationType="fade"
        backdropColor="#000"
        supportedOrientations={['portrait', 'landscape']}
        onRequestClose={poke}>
        <ScreenSaver size={Math.min(width, height) * 0.6} onWake={poke} />
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

type Today = { temperature?: number; templow?: number; precipitation_probability?: number };

/** Today's high, low and chance of rain, from the weather entity's daily forecast. */
function useForecast(conn: Connection | null, entityId?: string) {
  const [today, setToday] = useState<Today>();
  useEffect(() => {
    if (!conn || !entityId) return;
    const sub = conn
      .subscribeMessage<{ forecast?: Today[] }>((m) => setToday(m.forecast?.[0]), {
        type: 'weather/subscribe_forecast',
        forecast_type: 'daily',
        entity_id: entityId,
      })
      .catch(() => undefined); // no daily forecast: just no high and low
    return () => void sub.then((unsub) => unsub?.());
  }, [conn, entityId]);
  return today;
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
  const weather = byDomain(entities, 'weather')[0];
  const today = useForecast(conn, weather?.entity_id);
  const [sky, icon] = SKY[weather?.state ?? ''] ?? [weather?.state ?? '', 'cloud.fill'];
  const temp = weather?.attributes.temperature;
  const round = (n?: number) => (n === undefined ? '–' : Math.round(n));
  const date = now.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
  return (
    <Glass width={size} label={temp === undefined ? `${time(now)}, ${date}` : `${round(temp)} degrees, ${sky}`}>
      <View style={styles.between}>
        <Text style={styles.small}>{time(now)}</Text>
        <Text style={styles.small}>{date}</Text>
      </View>
      {temp === undefined ? (
        <Text style={[styles.big, { fontSize: size * 0.22 }]}>{time(now)}</Text>
      ) : (
        <View>
          <Text style={[styles.big, { fontSize: size * 0.3 }]}>{round(temp)}°</Text>
          <View style={styles.sky}>
            <SymbolView name={icon} size={20} tintColor="#fff" type="multicolor" />
            <Text style={styles.title}>{sky}</Text>
          </View>
          {today && (
            <Text style={styles.sub}>
              H: {round(today.temperature)}°   L: {round(today.templow)}°
              {today.precipitation_probability !== undefined ? `   ☂ ${today.precipitation_probability}%` : ''}
            </Text>
          )}
        </View>
      )}
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

function ScreenSaver({ size, onWake }: { size: number; onWake: () => void }) {
  const now = useNow();
  // Drift a little each minute so nothing stays burned into the same pixels.
  const drift = ((now.getMinutes() % 7) - 3) * 8;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel="Show the dashboard" onPress={onWake} style={styles.saver}>
      <View style={{ transform: [{ translateX: drift }, { translateY: -drift }], alignItems: 'center', gap: 24 }}>
        <AnalogClock size={size} dark />
        <Text style={styles.saverDate}>{now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}</Text>
      </View>
    </Pressable>
  );
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

function DeviceTile({ entity, size, onLongPress }: { entity: HassEntity; size: number; onLongPress: () => void }) {
  const { off, isOn, state, rgb: [r, g, b], icon, toggle } = useDevice(entity);
  return (
    <Glass
      width={size}
      on={isOn}
      label={`${name(entity)}, ${state}`}
      hint="Hold for timers, schedules and settings"
      onPress={off ? undefined : toggle}
      onLongPress={onLongPress}
      center>
      <DeviceIcon entity={entity} isOn={isOn} icon={icon} rgb={[r, g, b]} size={size * 0.2} dim={off} />
      <Label title={name(entity)} sub={state} dark={isOn} />
    </Glass>
  );
}

/**
 * A device's icon, moving the way the device does: a fan spins (faster at a higher speed), a vacuum wiggles while it
 * cleans, a TV or speaker pulses while it plays, and a light glows in its own colour. Switching gives it a little pop.
 * Still with Reduce Motion on.
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
  const domain = domainOf(entity);
  const motion =
    !isOn || still ? undefined
    : domain === 'fan' ? 'spin'
    : domain === 'vacuum' ? 'wiggle'
    : domain === 'media_player' && entity.state === 'playing' ? 'pulse'
    : undefined;
  const percent: number = entity.attributes.percentage ?? 100;
  const loop = useSharedValue(0);
  const pop = useSharedValue(1);
  const glow = useSharedValue(isOn ? 1 : 0);
  const was = useRef(isOn);

  useEffect(() => {
    loop.set(0);
    if (motion === 'spin') loop.set(withRepeat(withTiming(1, { duration: 2400 - percent * 18, easing: Easing.linear }), -1));
    else if (motion) loop.set(withRepeat(withTiming(1, { duration: motion === 'pulse' ? 900 : 300, easing: Easing.inOut(Easing.quad) }), -1, true));
    return () => cancelAnimation(loop);
  }, [motion, percent, loop]);

  useEffect(() => {
    glow.set(withTiming(isOn ? 1 : 0, { duration: 400 }));
    if (was.current !== isOn && !still) pop.set(withSequence(withTiming(1.25, { duration: 120 }), withSpring(1)));
    was.current = isOn;
  }, [isOn, still, glow, pop]);

  const moving = useAnimatedStyle(() => ({
    transform: [
      { scale: pop.value * (motion === 'pulse' ? 1 + loop.value * 0.14 : 1) },
      { rotate: motion === 'spin' ? `${loop.value * 360}deg` : motion === 'wiggle' ? `${(loop.value - 0.5) * 18}deg` : '0deg' },
    ],
  }));
  const halo = useAnimatedStyle(() => ({ opacity: glow.value }));
  const brightness = (entity.attributes.brightness ?? 255) / 255;
  return (
    <View style={{ width: size * 1.4, height: size * 1.4, alignItems: 'center', justifyContent: 'center' }}>
      {domain === 'light' && (
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
      <Animated.View style={moving}>
        <SymbolView name={icon} size={size} tintColor={isOn ? `rgb(${r},${g},${b})` : dim ? '#ffffff55' : '#fff'} />
      </Animated.View>
    </View>
  );
}

function CameraTile({ camera, width, height, onPress }: { camera: HassEntity; width: number; height: number; onPress: () => void }) {
  const { creds, entities } = useHA();
  const motion = entities[`binary_sensor.${camera.entity_id.split('.')[1]}_motion`]?.state === 'on';
  const picture: string | undefined = camera.attributes.entity_picture;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${name(camera)} live view`}
      onPress={onPress}
      style={({ pressed }) => [styles.camera, { width, height }, pressed && styles.pressed]}>
      {creds && picture && <Image source={{ uri: creds.url + picture }} style={StyleSheet.absoluteFill} />}
      <View style={styles.cameraLabel}>
        {motion && <View style={styles.dot} />}
        <Text style={styles.cameraName} numberOfLines={1}>
          {name(camera)}
        </Text>
        <SymbolView name="play.circle.fill" size={20} tintColor="#fff" />
      </View>
    </Pressable>
  );
}

/**
 * Every camera's snapshot; Live plays them all at once until Stop, 2 minutes, or the page being swiped away or covered.
 * "Every 6 hours" keeps the snapshots fresh with a Home Assistant automation.
 */
function CameraPage({ cameras, width, active, onWatch }: {
  cameras: HassEntity[];
  width: number;
  active: boolean;
  onWatch: (camera: HassEntity) => void;
}) {
  const { creds } = useHA();
  const [live, setLive] = useState(false);
  if (live && !active) setLive(false);
  const stop = useCallback(() => setLive(false), []);
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
          <Pill icon={refreshing ? 'checkmark.circle.fill' : 'clock'} label="New snapshot every 6 hours" on={refreshing} onPress={toggleSnapshots} />
          <Pill icon={live ? 'stop.fill' : 'play.fill'} label={live ? 'Stop' : 'Live'} on={live} onPress={() => setLive(!live)} />
        </View>
      </View>
      {creds && live ? (
        <LiveCameras cameras={cameras} w={w} onWatch={onWatch} onStop={stop} />
      ) : (
        <View style={styles.flow}>
          {cameras.map((c) => (
            <CameraTile key={c.entity_id} camera={c} width={w} height={Math.round((w * 9) / 16)} onPress={() => onWatch(c)} />
          ))}
        </View>
      )}
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

function LiveCameras({ cameras, w, onWatch, onStop }: {
  cameras: HassEntity[];
  w: number;
  onWatch: (camera: HassEntity) => void;
  onStop: () => void;
}) {
  const { creds } = useHA();
  useEffect(() => {
    const t = setTimeout(onStop, LIVE_MS);
    return () => clearTimeout(t);
  }, [onStop]);
  return (
    <View style={styles.flow}>
      {cameras.map((c) => (
        <LiveTile
          key={c.entity_id}
          creds={creds!}
          camera={{ slug: c.attributes.snapshot_of, name: name(c) }}
          width={w}
          hidden={false}
          focused={false}
          onPress={() => onWatch(c)}
        />
      ))}
    </View>
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
  sky: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  heading: { color: '#fff', fontSize: 28, fontWeight: '700' },
  banner: { color: '#FF9F0A', fontSize: 15, fontWeight: '600' },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.14)' },
  pillOn: { backgroundColor: '#f2f2f7' },
  pillText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  halo: { position: 'absolute', shadowOpacity: 1, shadowOffset: { width: 0, height: 0 } },
  camera: { borderRadius: 28, overflow: 'hidden', backgroundColor: '#1c1c1e' },
  cameraLabel: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    padding: 14,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  cameraName: { flex: 1, color: '#fff', fontSize: 15, fontWeight: '700' },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#FF3B30' },
  hub: { position: 'absolute', backgroundColor: '#FF3B30' },
  saver: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#000' },
  saverDate: { color: 'rgba(255,255,255,0.7)', fontSize: 28, fontWeight: '500' },
  pressed: { opacity: 0.7 },
});
