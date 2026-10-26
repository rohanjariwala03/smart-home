import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import * as Haptics from 'expo-haptics';
import { useKeepAwake } from 'expo-keep-awake';
import { useIsFocused } from 'expo-router';
import { SymbolView, type SFSymbol } from 'expo-symbols';
import type { Connection, HassEntity } from 'home-assistant-js-websocket';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Alert, Image, Modal, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { allDevices, domainOf, ICONS, useDevice } from '@/components/device-tile';
import { DeviceSheet } from '@/components/device-sheet';
import { LiveGrid } from '@/components/live-grid';
import { LiveView } from '@/components/live-view';
import { useFavourites } from '@/favourites';
import { byDomain, name, useHA } from '@/ha';
import { runScene } from '@/scenes';

const GAP = 14;
const PAD = 24;
const IDLE_MS = 3 * 60_000;
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
 * every camera. A doorbell press opens that camera live. The screen stays on while this is showing; after 3 minutes
 * untouched it fades to a big clock, and a tap brings the dashboard back.
 */
export function Wall() {
  const { creds, entities, devices: registry, status } = useHA();
  const { favourites } = useFavourites();
  const { width, height } = useWindowDimensions();
  const focused = useIsFocused();
  const [detail, setDetail] = useState<string>();
  const [watch, setWatch] = useState<HassEntity>();
  const [grid, setGrid] = useState(false);
  const [idle, poke] = useIdle(IDLE_MS);

  useDoorbell((camera) => {
    poke();
    setGrid(false);
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
      <SafeAreaView style={styles.flex} edges={['top']}>
        <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false}>
          <ScrollView style={{ width }} contentContainerStyle={[styles.page, { width: span(cols) + PAD * 2 }]}>
            {status !== 'ready' && <Text style={styles.banner}>{status === 'connecting' ? 'Connecting…' : 'Hub offline · reconnecting'}</Text>}
            <View style={styles.row}>
              <WeatherTile size={span(2)} />
              <View style={[styles.flow, { width: span(cols - 2) }]}>{tiles.slice(0, beside)}</View>
            </View>
            <View style={styles.flow}>{tiles.slice(beside)}</View>
          </ScrollView>
          <CameraPage cameras={allCameras} width={width} onWatch={setWatch} onGrid={() => setGrid(true)} />
        </ScrollView>
      </SafeAreaView>

      {focused && <KeepAwake />}
      <Modal
        visible={idle && focused && !watch && !grid && !detail}
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
      {creds && grid && (
        <LiveGrid
          creds={creds}
          cameras={allCameras.map((e) => ({ slug: e.attributes.snapshot_of, name: name(e) }))}
          onClose={close(() => setGrid(false))}
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
      <Text style={[styles.title, dark && styles.ink]} numberOfLines={2}>
        {title}
      </Text>
      {sub && (
        <Text style={[styles.sub, dark && styles.inkSub]} numberOfLines={1}>
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
    <Glass width={size} on={running} label={`${name(scene)} scene`} onPress={run}>
      <SymbolView name={ICONS[domainOf(scene)]} size={size * 0.18} tintColor={running ? '#1c1c1e' : '#fff'} />
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
      onLongPress={onLongPress}>
      <SymbolView name={icon} size={size * 0.18} tintColor={isOn ? `rgb(${r},${g},${b})` : off ? '#ffffff55' : '#fff'} />
      <Label title={name(entity)} sub={state} dark={isOn} />
    </Glass>
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

function CameraPage({ cameras, width, onWatch, onGrid }: {
  cameras: HassEntity[];
  width: number;
  onWatch: (camera: HassEntity) => void;
  onGrid: () => void;
}) {
  const cols = width > 900 ? 3 : 2;
  const w = Math.floor((width - PAD * 2 - GAP * (cols - 1)) / cols);
  return (
    <ScrollView style={{ width }} contentContainerStyle={styles.page}>
      <View style={styles.between}>
        <Text style={styles.heading}>Cameras</Text>
        {cameras.length > 1 && (
          <Pressable accessibilityRole="button" onPress={onGrid} style={({ pressed }) => [styles.pill, pressed && styles.pressed]}>
            <SymbolView name="square.grid.2x2.fill" size={16} tintColor="#fff" />
            <Text style={styles.title}>All live</Text>
          </Pressable>
        )}
      </View>
      <View style={styles.flow}>
        {cameras.map((c) => (
          <CameraTile key={c.entity_id} camera={c} width={w} height={Math.round((w * 9) / 16)} onPress={() => onWatch(c)} />
        ))}
      </View>
    </ScrollView>
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
  center: { alignItems: 'center', justifyContent: 'center', padding: 0 },
  title: { color: '#fff', fontSize: 17, fontWeight: '600' },
  sub: { color: 'rgba(255,255,255,0.65)', fontSize: 14, marginTop: 2 },
  ink: { color: '#1c1c1e' },
  inkSub: { color: 'rgba(28,28,30,0.6)' },
  small: { color: 'rgba(255,255,255,0.8)', fontSize: 15, fontWeight: '600' },
  big: { color: '#fff', fontWeight: '300', letterSpacing: -2, fontVariant: ['tabular-nums'] },
  sky: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  heading: { color: '#fff', fontSize: 28, fontWeight: '700' },
  banner: { color: '#FF9F0A', fontSize: 15, fontWeight: '600' },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.14)' },
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
