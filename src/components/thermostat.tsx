import * as Haptics from 'expo-haptics';
import { SymbolView, type SFSymbol } from 'expo-symbols';
import type { HassEntity } from 'home-assistant-js-websocket';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';

import { climateLook, climateRooms, degrees, HVAC_MODE } from '@/climate';
import { name, unavailable, useHA } from '@/ha';

// The thermostat the way the Ecobee app shows it: a big reading on a dark card, the set point as a bubble you drag
// up and down a rail (heat and cool bubbles in Heat/Cool), big − / + buttons for each set point, and one-tap buttons
// for mode, fan and comfort setting.

const HEAT = '#FF8A3D';
const COOL = '#409CFF';
const RAIL = 300;
const BUBBLE = 56;

const MODE_LOOK: Record<string, { icon: SFSymbol; color: string }> = {
  off: { icon: 'power', color: '#8E8E93' },
  heat: { icon: 'flame.fill', color: HEAT },
  cool: { icon: 'snowflake', color: COOL },
  heat_cool: { icon: 'arrow.up.arrow.down', color: '#B48CFF' },
  auto: { icon: 'arrow.up.arrow.down', color: '#B48CFF' },
  dry: { icon: 'humidity.fill', color: COOL },
  fan_only: { icon: 'fan.fill', color: '#FFFFFF' },
};
const PRESET_ICON: Record<string, SFSymbol> = { home: 'house.fill', away: 'figure.walk', sleep: 'moon.fill' };

type Key = 'temperature' | 'target_temp_low' | 'target_temp_high';
type Targets = Partial<Record<Key, number>>;

export function Thermostat({ entity }: { entity: HassEntity }) {
  const { entities, devices, areas, call } = useHA();
  const a = entity.attributes;
  const look = climateLook(entity);
  const fahrenheit = a.max_temp > 40;
  const step: number = a.target_temp_step ?? (fahrenheit ? 1 : 0.5);
  const range = a.temperature == null && a.target_temp_low != null;
  const off = entity.state === 'off' || unavailable(entity);
  const gap = range ? (fahrenheit ? 3 : 1.5) : 0; // heat stays this far below cool

  // What you've set, until Home Assistant reports it back.
  const [pending, setPending] = useState<Targets>();
  const send = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(send.current), []);
  const shown: Targets = { temperature: a.temperature, target_temp_low: a.target_temp_low, target_temp_high: a.target_temp_high, ...pending };
  const set = (next: Targets, wait = 900) => {
    setPending(next);
    clearTimeout(send.current);
    send.current = setTimeout(() => {
      const data = range ? { target_temp_low: next.target_temp_low, target_temp_high: next.target_temp_high } : { temperature: next.temperature };
      call('climate', 'set_temperature', { entity_id: entity.entity_id, ...data }).finally(() => setPending(undefined));
    }, wait);
  };
  const move = (key: Key, v: number, wait?: number) => {
    const next: Targets = { ...shown, [key]: Math.min(a.max_temp, Math.max(a.min_temp, Math.round(v / step) * step)) };
    if (key === 'target_temp_low' && next.target_temp_high != null) next.target_temp_low = Math.min(next.target_temp_low!, next.target_temp_high - gap);
    if (key === 'target_temp_high' && next.target_temp_low != null) next.target_temp_high = Math.max(next.target_temp_high!, next.target_temp_low + gap);
    if (next[key] === shown[key]) return;
    Haptics.selectionAsync();
    set(next, wait);
  };

  const keys: Key[] = range ? ['target_temp_low', 'target_temp_high'] : ['temperature'];
  const colors = range ? [HEAT, COOL] : [entity.state === 'cool' ? COOL : HEAT];
  const labels = range ? ['Heat to', 'Cool to'] : [entity.state === 'cool' ? 'Cool to' : entity.state === 'heat' ? 'Heat to' : 'Set to'];
  const accent = look.working ? `rgb(${look.rgb.join()})` : '#FFFFFF';
  const rooms = climateRooms(entity, entities, devices, areas);
  const modes: string[] = a.hvac_modes ?? [];
  const fans: string[] = a.fan_modes ?? [];
  const presets: string[] = a.preset_modes ?? [];
  const details = [
    !unavailable(entity) && look.doing !== HVAC_MODE[entity.state] && (HVAC_MODE[entity.state] ?? words(entity.state)), // the mode, unless it's the line above
    a.current_humidity != null && `${Math.round(a.current_humidity)}% humidity`,
    a.preset_mode && words(a.preset_mode),
  ].filter(Boolean);

  return (
    <View style={styles.gap}>
      <View style={[styles.hero, off && styles.dim]}>
        {look.working && <View style={[styles.glow, { backgroundColor: accent }]} />}
        <View style={styles.reading}>
          <View style={styles.status}>
            <SymbolView name={look.icon} size={18} tintColor={accent} />
            <Text style={[styles.statusText, { color: accent }]}>{unavailable(entity) ? 'Unavailable' : look.doing}</Text>
          </View>
          <Text style={styles.now} numberOfLines={1} accessibilityLabel={`Inside ${degrees(look.current)}`}>
            {degrees(look.current)}
          </Text>
          <Text style={styles.small}>{details.join('  ·  ')}</Text>
        </View>
        {!off && (
          <SetPointRail
            values={shown}
            keys={keys}
            colors={colors}
            labels={labels}
            current={look.current}
            min={a.min_temp}
            max={a.max_temp}
            step={step}
            span={fahrenheit ? 24 : 12}
            onMove={move}
            onRelease={() => set(shown, 300)}
          />
        )}
      </View>

      {!off && (
        <View style={styles.panel}>
          {keys.map((k, i) => (
            <View key={k} style={styles.setRow}>
              <View style={[styles.swatch, { backgroundColor: colors[i] }]} />
              <Text style={styles.setLabel}>{labels[i]}</Text>
              <StepButton icon="minus" label={`${labels[i]}, lower`} onPress={() => move(k, (shown[k] ?? a.min_temp) - step)} />
              <Text style={styles.setValue}>{degrees(shown[k])}</Text>
              <StepButton icon="plus" label={`${labels[i]}, higher`} onPress={() => move(k, (shown[k] ?? a.min_temp) + step)} />
            </View>
          ))}
        </View>
      )}

      {modes.length > 0 && (
        <Segments
          title="Mode"
          value={entity.state}
          options={modes.map((m) => ({ key: m, label: HVAC_MODE[m] ?? words(m), ...(MODE_LOOK[m] ?? { icon: 'thermometer.medium', color: '#FFFFFF' }) }))}
          onPick={(m) => call('climate', 'set_hvac_mode', { entity_id: entity.entity_id, hvac_mode: m })}
        />
      )}
      {fans.length > 0 && (
        <Segments
          title="Fan"
          value={a.fan_mode}
          options={fans.map((f) => ({ key: f, label: words(f), icon: f === 'auto' ? 'fan' : 'fan.fill', color: '#5AC8FA' }))}
          onPick={(f) => call('climate', 'set_fan_mode', { entity_id: entity.entity_id, fan_mode: f })}
        />
      )}
      {presets.length > 0 && (
        <Segments
          title="Comfort setting"
          value={a.preset_mode}
          options={presets.map((p) => ({ key: p, label: words(p), icon: PRESET_ICON[p] ?? 'sparkles', color: '#30D158' }))}
          onPick={(p) => call('climate', 'set_preset_mode', { entity_id: entity.entity_id, preset_mode: p })}
        />
      )}

      <History entity={entity} />

      {rooms.length > 1 && (
        <View style={styles.sensors}>
          {rooms.map((r) => (
            <View key={r.key} style={styles.sensor} accessible accessibilityLabel={`${r.name} ${degrees(r.temperature)}${r.occupied ? ', someone is there' : ''}`}>
              <View style={styles.status}>
                <Text style={styles.sensorName} numberOfLines={1}>{r.name}</Text>
                {r.occupied !== undefined && <SymbolView name={r.occupied ? 'person.fill' : 'person'} size={14} tintColor={r.occupied ? '#30D158' : DIM} />}
              </View>
              <Text style={styles.sensorTemp}>{degrees(r.temperature)}</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

type Row = { s: string; a?: Record<string, any>; lu: number };

/**
 * The last day's temperature as bars, orange where it was heating and blue where it was cooling, then how long it ran
 * today and on each of the last 7 days. From Home Assistant's history (it keeps 10 days by default).
 */
function History({ entity }: { entity: HassEntity }) {
  const { conn } = useHA();
  const [rows, setRows] = useState<Row[]>();
  const [now] = useState(Date.now);
  const id = entity.entity_id;

  useEffect(() => {
    conn
      ?.sendMessagePromise<Record<string, Row[]>>({
        type: 'history/history_during_period',
        start_time: new Date(now - 7 * 864e5).toISOString(),
        entity_ids: [id],
        minimal_response: false,
        no_attributes: false,
        significant_changes_only: false,
      })
      .then((r) => setRows(r[id] ?? []), () => setRows([]));
  }, [conn, id, now]);

  if (!rows?.length) return null;

  // Each row holds until the next one. Rows only carry attributes when they changed; keep the last ones seen.
  const points: { from: number; to: number; action?: string; temp?: number }[] = [];
  let attrs: Record<string, any> = {};
  for (const [i, r] of rows.entries()) {
    attrs = r.a ?? attrs;
    points.push({ from: r.lu * 1000, to: rows[i + 1] ? rows[i + 1].lu * 1000 : now, action: attrs.hvac_action, temp: attrs.current_temperature });
  }
  const ran = (action: 'heating' | 'cooling', a: number, b: number) =>
    points.reduce((sum, p) => (p.action === action || (action === 'heating' && p.action === 'preheating') ? sum + Math.max(0, Math.min(b, p.to) - Math.max(a, p.from)) : sum), 0);
  const tempAt = (t: number) => [...points].reverse().find((p) => p.from <= t && p.temp != null)?.temp;

  const BUCKET = 20 * 60e3;
  const bars = Array.from({ length: 72 }, (_, i) => {
    const start = now - 864e5 + i * BUCKET;
    return { start, temp: tempAt(start + BUCKET), heat: ran('heating', start, start + BUCKET), cool: ran('cooling', start, start + BUCKET) };
  });
  const temps = bars.flatMap((b) => (b.temp != null ? [b.temp] : []));
  if (!temps.length) return null;
  const low = Math.floor(Math.min(...temps)) - 1;
  const high = Math.ceil(Math.max(...temps)) + 1;

  const midnight = new Date(now).setHours(0, 0, 0, 0);
  const days = Array.from({ length: 7 }, (_, i) => {
    const start = midnight - (6 - i) * 864e5;
    const end = Math.min(start + 864e5, now);
    return { start, heat: ran('heating', start, end), cool: ran('cooling', start, end) };
  });
  const most = Math.max(...days.map((d) => d.heat + d.cool), 3600e3);
  const today = days[6];
  const hours = (ms: number) => {
    const min = Math.round(ms / 60e3);
    return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${min % 60} min`;
  };
  const summary = [today.heat > 0 && `Heated ${hours(today.heat)}`, today.cool > 0 && `Cooled ${hours(today.cool)}`].filter(Boolean).join(' · ') || 'Hasn’t run today';

  return (
    <View style={styles.panel}>
      <Text style={styles.panelTitle}>Last 24 hours</Text>
      <Text style={styles.setLabel}>{summary}</Text>
      <View style={styles.chart} accessible accessibilityLabel={`Temperature over the last day, between ${degrees(Math.min(...temps))} and ${degrees(Math.max(...temps))}. ${summary} today.`}>
        <View style={styles.axis}>
          <Text style={styles.tick}>{high}°</Text>
          <Text style={styles.tick}>{low}°</Text>
        </View>
        {bars.map((b) => (
          <View key={b.start} style={styles.chartCol}>
            {b.temp != null && (
              <View
                style={[
                  styles.chartBar,
                  { height: `${Math.max(4, ((b.temp - low) / (high - low)) * 100)}%`, backgroundColor: b.heat > 0 ? HEAT : b.cool > 0 ? COOL : '#FFFFFF33' },
                ]}
              />
            )}
          </View>
        ))}
      </View>
      <View style={styles.ticks}>
        {[24, 18, 12, 6].map((h) => (
          <Text key={h} style={styles.tick}>{new Date(now - h * 3600e3).toLocaleTimeString([], { hour: 'numeric' })}</Text>
        ))}
        <Text style={styles.tick}>Now</Text>
      </View>

      <Text style={[styles.panelTitle, styles.spaced]}>Last 7 days</Text>
      <View style={styles.week}>
        {days.map((d) => (
          <View key={d.start} style={styles.dayCol} accessible accessibilityLabel={`${new Date(d.start).toLocaleDateString([], { weekday: 'long' })}: ${d.heat || d.cool ? [d.heat && `heated ${hours(d.heat)}`, d.cool && `cooled ${hours(d.cool)}`].filter(Boolean).join(', ') : 'didn’t run'}`}>
            <View style={styles.dayTrack}>
              <View style={{ height: `${(d.cool / most) * 100}%`, backgroundColor: COOL }} />
              <View style={{ height: `${(d.heat / most) * 100}%`, backgroundColor: HEAT }} />
            </View>
            <Text style={styles.tick}>{new Date(d.start).toLocaleDateString([], { weekday: 'narrow' })}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function StepButton({ icon, label, onPress }: { icon: 'minus' | 'plus'; label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} hitSlop={6} onPress={onPress} style={({ pressed }) => [styles.step, pressed && styles.stepPressed]}>
      <SymbolView name={icon} size={22} weight="semibold" tintColor="#FFFFFF" />
    </Pressable>
  );
}

/** One tap picks; the choice lights up straight away, before Home Assistant confirms it. */
function Segments({ title, value, options, onPick }: {
  title: string;
  value?: string;
  options: { key: string; label: string; icon: SFSymbol; color: string }[];
  onPick: (key: string) => Promise<unknown>;
}) {
  const [picked, setPicked] = useState<string>();
  const current = picked ?? value;
  return (
    <View style={styles.panel}>
      <Text style={styles.panelTitle}>{title}</Text>
      <View style={styles.segments}>
        {options.map((o) => {
          const on = o.key === current;
          return (
            <Pressable
              key={o.key}
              accessibilityRole="button"
              accessibilityLabel={o.label}
              accessibilityState={{ selected: on }}
              onPress={() => {
                if (on) return;
                Haptics.selectionAsync();
                setPicked(o.key);
                onPick(o.key).finally(() => setPicked(undefined));
              }}
              style={({ pressed }) => [styles.segment, on && { backgroundColor: `${o.color}33`, borderColor: o.color }, pressed && styles.pressed]}>
              <SymbolView name={o.icon} size={20} tintColor={on ? o.color : DIM} />
              <Text style={[styles.segmentText, on && styles.segmentOn]} numberOfLines={1}>{o.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/** The thermostat at a glance, the same look: what it's doing, the reading, its set points and each room. */
export function ThermostatCard({ entity, width, height, onPress }: { entity: HassEntity; width?: number; height?: number; onPress: () => void }) {
  const { entities, devices, areas } = useHA();
  const a = entity.attributes;
  const look = climateLook(entity);
  const accent = look.working ? `rgb(${look.rgb.join()})` : '#FFFFFF';
  const off = entity.state === 'off' || unavailable(entity);
  const points: [number, string][] =
    off ? []
    : a.temperature != null ? [[a.temperature, entity.state === 'cool' ? COOL : HEAT]]
    : a.target_temp_low != null ? [[a.target_temp_low, HEAT], [a.target_temp_high, COOL]]
    : [];
  const rooms = climateRooms(entity, entities, devices, areas).slice(1); // the thermostat's own reading is the big one
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${name(entity)}, ${degrees(look.current)} inside, ${unavailable(entity) ? 'unavailable' : look.state}`}
      accessibilityHint="Opens the thermostat"
      onPress={onPress}
      style={({ pressed }) => [styles.card, { width, height }, pressed && styles.pressed]}>
      {look.working && <View style={[styles.glow, { backgroundColor: accent }]} />}
      <View style={styles.cardTop}>
        <View style={styles.reading}>
          <View style={styles.status}>
            <SymbolView name={look.icon} size={15} tintColor={accent} />
            <Text style={[styles.cardStatus, { color: accent }]} numberOfLines={1}>{unavailable(entity) ? 'Unavailable' : look.doing}</Text>
          </View>
          <Text style={styles.cardNow} numberOfLines={1}>{degrees(look.current)}</Text>
        </View>
        <View style={styles.points}>
          {points.map(([v, color]) => (
            <View key={color} style={[styles.point, { backgroundColor: color }]}>
              <Text style={styles.pointText}>{Math.round(v * 10) / 10}</Text>
            </View>
          ))}
        </View>
      </View>
      {rooms.length > 0 && (
        <View style={styles.cardRooms}>
          {rooms.map((r) => (
            <View key={r.key} style={styles.cardRoom}>
              <Text style={styles.small} numberOfLines={1}>{r.name}</Text>
              {r.occupied && <View style={styles.here} />}
              <Text style={styles.cardRoomTemp}>{degrees(r.temperature)}</Text>
            </View>
          ))}
        </View>
      )}
    </Pressable>
  );
}

/**
 * The set points as bubbles on a vertical rail: drag a bubble (or anywhere on the rail; the nearest bubble moves).
 * The rail shows `span` degrees around the reading, fixed while you drag, so a step is a comfortable distance.
 */
function SetPointRail({ values, keys, colors, labels, current, min, max, step, span, onMove, onRelease }: {
  values: Targets;
  keys: Key[];
  colors: string[];
  labels: string[];
  current?: number;
  min: number;
  max: number;
  step: number;
  span: number;
  onMove: (key: Key, v: number) => void;
  onRelease: () => void;
}) {
  const points = keys.map((k) => values[k] ?? min);
  const middle = (Math.min(...points, current ?? Infinity) + Math.max(...points, current ?? -Infinity)) / 2;
  const fresh = { low: Math.max(min, Math.min(max - span, Math.round(middle - span / 2))), high: 0 };
  fresh.high = Math.min(max, fresh.low + span);
  const [drag, setDrag] = useState<{ low: number; high: number; key: Key; from: number }>();
  const view = drag ?? fresh;
  const y = (v: number) => RAIL * (1 - (v - view.low) / (view.high - view.low));

  // Takes the touch straight away (so the sheet doesn't scroll or close instead), and moves the bubble by as much as
  // the finger moves: touching the rail alone changes nothing.
  const pan = Gesture.Pan()
    .runOnJS(true)
    .minDistance(0)
    .onBegin((e) => {
      const nearest = keys.reduce((best, k) => (Math.abs(y(values[k] ?? min) - e.y) < Math.abs(y(values[best] ?? min) - e.y) ? k : best));
      setDrag({ ...fresh, key: nearest, from: values[nearest] ?? min });
    })
    .onUpdate((e) => drag && onMove(drag.key, drag.from - (e.translationY / RAIL) * (drag.high - drag.low)))
    .onEnd(() => drag && values[drag.key] !== drag.from && onRelease())
    .onFinalize(() => setDrag(undefined));

  return (
    <GestureHandlerRootView style={styles.rail}>
      <GestureDetector gesture={pan}>
        <View style={styles.railHit}>
          <View style={styles.track} />
          {current != null && current >= view.low && current <= view.high && (
            <View style={[styles.marker, { top: y(current) - 1 }]} />
          )}
          {keys.map((k, i) => (
            <View
              key={k}
              accessible
              accessibilityRole="adjustable"
              accessibilityLabel={labels[i]}
              accessibilityValue={{ text: degrees(values[k]) }}
              accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
              onAccessibilityAction={(e) => onMove(k, (values[k] ?? min) + (e.nativeEvent.actionName === 'increment' ? step : -step))}
              style={[styles.bubble, { backgroundColor: colors[i], top: Math.max(0, Math.min(RAIL, y(values[k] ?? min))) - BUBBLE / 2 }]}>
              <Text style={styles.bubbleText}>{Math.round((values[k] ?? min) * 10) / 10}</Text>
            </View>
          ))}
        </View>
      </GestureDetector>
    </GestureHandlerRootView>
  );
}

/** "on_low" → "On low" */
export const words = (s: string) => s[0].toUpperCase() + s.slice(1).replace(/_/g, ' ');

const NAVY = '#0D1B2A';
const DIM = '#9FB0C3';

const styles = StyleSheet.create({
  gap: { gap: 16 },
  hero: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: NAVY,
    borderRadius: 28,
    borderCurve: 'continuous',
    padding: 24,
    minHeight: RAIL + 48,
    overflow: 'hidden',
  },
  dim: { opacity: 0.6 },
  glow: { position: 'absolute', width: 360, height: 360, borderRadius: 180, left: -120, top: -40, opacity: 0.22 },
  reading: { flex: 1, gap: 4 },
  status: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  statusText: { fontSize: 17, fontWeight: '600' },
  now: { color: '#FFFFFF', fontSize: 104, lineHeight: 116, fontWeight: '200', fontVariant: ['tabular-nums'] },
  small: { color: DIM, fontSize: 14, fontWeight: '500' },
  rail: { width: 80, height: RAIL },
  railHit: { flex: 1, alignItems: 'center' },
  track: { position: 'absolute', top: 0, bottom: 0, width: 6, borderRadius: 3, backgroundColor: '#FFFFFF26' },
  marker: { position: 'absolute', width: 28, height: 2, borderRadius: 1, backgroundColor: '#FFFFFF' },
  bubble: {
    position: 'absolute',
    width: BUBBLE,
    height: BUBBLE,
    borderRadius: BUBBLE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0 4px 12px rgba(0,0,0,0.35)',
  },
  bubbleText: { color: '#FFFFFF', fontSize: 20, fontWeight: '700', fontVariant: ['tabular-nums'] },
  pressed: { opacity: 0.6 },
  panel: { backgroundColor: NAVY, borderRadius: 24, borderCurve: 'continuous', padding: 16, gap: 12 },
  panelTitle: { color: DIM, fontSize: 13, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
  setRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  swatch: { width: 10, height: 10, borderRadius: 5 },
  setLabel: { flex: 1, color: '#FFFFFF', fontSize: 17, fontWeight: '600' },
  setValue: { minWidth: 76, textAlign: 'center', color: '#FFFFFF', fontSize: 34, fontWeight: '300', fontVariant: ['tabular-nums'] },
  step: { width: 52, height: 52, borderRadius: 26, backgroundColor: '#FFFFFF1F', alignItems: 'center', justifyContent: 'center' },
  stepPressed: { backgroundColor: '#FFFFFF40', transform: [{ scale: 0.94 }] },
  segments: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  segment: {
    flexGrow: 1,
    flexBasis: 72,
    alignItems: 'center',
    gap: 6,
    paddingVertical: 12,
    borderRadius: 16,
    borderCurve: 'continuous',
    borderWidth: 1.5,
    borderColor: 'transparent',
    backgroundColor: '#FFFFFF0F',
  },
  chart: { flexDirection: 'row', alignItems: 'flex-end', height: 110, gap: 1 },
  axis: { height: '100%', justifyContent: 'space-between', marginRight: 6 },
  chartCol: { flex: 1, height: '100%', justifyContent: 'flex-end' },
  chartBar: { borderRadius: 1.5 },
  ticks: { flexDirection: 'row', justifyContent: 'space-between', paddingLeft: 28 },
  tick: { color: DIM, fontSize: 11, fontWeight: '500', fontVariant: ['tabular-nums'] },
  spaced: { marginTop: 8 },
  week: { flexDirection: 'row', gap: 10, height: 90 },
  dayCol: { flex: 1, alignItems: 'center', gap: 4 },
  dayTrack: { flex: 1, width: '100%', borderRadius: 6, overflow: 'hidden', justifyContent: 'flex-end', backgroundColor: '#FFFFFF14' },
  segmentText: { color: DIM, fontSize: 13, fontWeight: '600' },
  segmentOn: { color: '#FFFFFF' },
  sensors: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  sensor: { flexGrow: 1, flexBasis: 140, backgroundColor: NAVY, borderRadius: 20, borderCurve: 'continuous', padding: 16, gap: 4 },
  sensorName: { color: DIM, fontSize: 14, fontWeight: '600', flexShrink: 1 },
  card: { backgroundColor: NAVY, borderRadius: 28, borderCurve: 'continuous', padding: 18, gap: 12, overflow: 'hidden', justifyContent: 'space-between' },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  cardStatus: { fontSize: 15, fontWeight: '600' },
  cardNow: { color: '#FFFFFF', fontSize: 60, lineHeight: 68, fontWeight: '200', fontVariant: ['tabular-nums'] },
  points: { gap: 8 },
  point: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  pointText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700', fontVariant: ['tabular-nums'] },
  cardRooms: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  cardRoom: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#FFFFFF14', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  cardRoomTemp: { color: '#FFFFFF', fontSize: 14, fontWeight: '600', fontVariant: ['tabular-nums'] },
  here: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#30D158' },
  sensorTemp: { color: '#FFFFFF', fontSize: 34, fontWeight: '300', fontVariant: ['tabular-nums'] },
});
