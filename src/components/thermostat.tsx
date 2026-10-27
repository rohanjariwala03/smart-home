import * as Haptics from 'expo-haptics';
import { SymbolView, type SFSymbol } from 'expo-symbols';
import type { HassEntity } from 'home-assistant-js-websocket';
import { useEffect, useRef, useState } from 'react';
import { ActionSheetIOS, findNodeHandle, Pressable, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';

import { climateLook, climateRooms, degrees, HVAC_MODE } from '@/climate';
import { name, unavailable, useHA } from '@/ha';

// The thermostat the way the Ecobee app shows it: a big reading on a dark card, the set point as a bubble you drag
// up and down a rail (heat and cool bubbles in Auto), and round buttons for mode, fan and comfort setting.

const HEAT = '#FF8A3D';
const COOL = '#409CFF';
const RAIL = 300;
const BUBBLE = 56;

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

  // What you've dragged to, until Home Assistant reports it back.
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

  const accent = look.working ? `rgb(${look.rgb.join()})` : '#FFFFFF';
  const rooms = climateRooms(entity, entities, devices, areas);
  const modes: string[] = a.hvac_modes ?? [];
  const fans: string[] = a.fan_modes ?? [];
  const presets: string[] = a.preset_modes ?? [];
  const modeName = (m: string) => (m === 'heat_cool' && modes.includes('auto') ? 'Heat/Cool' : (HVAC_MODE[m] ?? words(m)));

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
          <View style={styles.status}>
            {a.current_humidity != null && (
              <>
                <SymbolView name="humidity.fill" size={14} tintColor={DIM} />
                <Text style={styles.small}>{Math.round(a.current_humidity)}%</Text>
              </>
            )}
            {a.preset_mode && <Text style={styles.small}>{a.current_humidity != null ? '  ·  ' : ''}{words(a.preset_mode)}</Text>}
          </View>
        </View>
        {!off && (
          <SetPointRail
            values={shown}
            keys={range ? ['target_temp_low', 'target_temp_high'] : ['temperature']}
            colors={range ? [HEAT, COOL] : [entity.state === 'cool' ? COOL : HEAT]}
            current={look.current}
            min={a.min_temp}
            max={a.max_temp}
            step={step}
            gap={range ? (fahrenheit ? 3 : 1.5) : 0}
            span={fahrenheit ? 24 : 12}
            onChange={set}
          />
        )}
      </View>

      <View style={styles.buttons}>
        {modes.length > 0 && (
          <RoundButton
            icon="power"
            title="Mode"
            value={modeName(entity.state)}
            options={modes.map(modeName)}
            onPick={(i) => call('climate', 'set_hvac_mode', { entity_id: entity.entity_id, hvac_mode: modes[i] })}
          />
        )}
        {fans.length > 0 && (
          <RoundButton
            icon="fan.fill"
            title="Fan"
            value={words(a.fan_mode ?? '–')}
            options={fans.map(words)}
            onPick={(i) => call('climate', 'set_fan_mode', { entity_id: entity.entity_id, fan_mode: fans[i] })}
          />
        )}
        {presets.length > 0 && (
          <RoundButton
            icon="house.fill"
            title="Comfort"
            value={a.preset_mode ? words(a.preset_mode) : 'None'}
            options={presets.map(words)}
            onPick={(i) => call('climate', 'set_preset_mode', { entity_id: entity.entity_id, preset_mode: presets[i] })}
          />
        )}
      </View>

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
function SetPointRail({ values, keys, colors, current, min, max, step, gap, span, onChange }: {
  values: Targets;
  keys: Key[];
  colors: string[];
  current?: number;
  min: number;
  max: number;
  step: number;
  gap: number;
  span: number;
  onChange: (next: Targets, wait?: number) => void;
}) {
  const points = keys.map((k) => values[k] ?? min);
  const middle = (Math.min(...points, current ?? Infinity) + Math.max(...points, current ?? -Infinity)) / 2;
  const fresh = { low: Math.max(min, Math.min(max - span, Math.round(middle - span / 2))), high: 0 };
  fresh.high = Math.min(max, fresh.low + span);
  const [drag, setDrag] = useState<{ low: number; high: number; key: Key; from: number }>();
  const view = drag ?? fresh;
  const y = (v: number) => RAIL * (1 - (v - view.low) / (view.high - view.low));

  const move = (key: Key, v: number, wait?: number) => {
    const next: Targets = { ...values, [key]: Math.min(max, Math.max(min, v)) };
    // Heat stays below cool by the thermostat's dead band.
    if (key === 'target_temp_low' && next.target_temp_high != null) next.target_temp_low = Math.min(next.target_temp_low!, next.target_temp_high - gap);
    if (key === 'target_temp_high' && next.target_temp_low != null) next.target_temp_high = Math.max(next.target_temp_high!, next.target_temp_low + gap);
    if (next[key] === values[key]) return;
    Haptics.selectionAsync();
    onChange(next, wait);
  };

  // Takes the touch straight away (so the sheet doesn't scroll or close instead), and moves the bubble by as much as
  // the finger moves: touching the rail alone changes nothing.
  const pan = Gesture.Pan()
    .runOnJS(true)
    .minDistance(0)
    .onBegin((e) => {
      const nearest = keys.reduce((best, k) => (Math.abs(y(values[k] ?? min) - e.y) < Math.abs(y(values[best] ?? min) - e.y) ? k : best));
      setDrag({ ...fresh, key: nearest, from: values[nearest] ?? min });
    })
    .onUpdate((e) => drag && move(drag.key, Math.round((drag.from - (e.translationY / RAIL) * (drag.high - drag.low)) / step) * step))
    .onEnd(() => drag && values[drag.key] !== drag.from && onChange(values, 300))
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
              accessibilityLabel={keys.length > 1 ? (i === 0 ? 'Heat to' : 'Cool to') : 'Set to'}
              accessibilityValue={{ text: degrees(values[k]) }}
              accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
              onAccessibilityAction={(e) => move(k, (values[k] ?? min) + (e.nativeEvent.actionName === 'increment' ? step : -step))}
              style={[styles.bubble, { backgroundColor: colors[i], top: Math.max(0, Math.min(RAIL, y(values[k] ?? min))) - BUBBLE / 2 }]}>
              <Text style={styles.bubbleText}>{Math.round((values[k] ?? min) * 10) / 10}</Text>
            </View>
          ))}
        </View>
      </GestureDetector>
    </GestureHandlerRootView>
  );
}

function RoundButton({ icon, title, value, options, onPick }: {
  icon: SFSymbol;
  title: string;
  value: string;
  options: string[];
  onPick: (i: number) => void;
}) {
  const ref = useRef<View>(null);
  const open = () => {
    Haptics.selectionAsync();
    ActionSheetIOS.showActionSheetWithOptions(
      // Anchored so it shows as a popover from the button on iPad.
      { title, options: [...options, 'Cancel'], cancelButtonIndex: options.length, anchor: findNodeHandle(ref.current) ?? undefined },
      (i) => i < options.length && onPick(i),
    );
  };
  return (
    <Pressable
      ref={ref}
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${value}`}
      onPress={open}
      style={({ pressed }) => [styles.button, pressed && styles.pressed]}>
      <View style={styles.round}>
        <SymbolView name={icon} size={22} tintColor="#FFFFFF" />
      </View>
      <Text style={styles.buttonTitle}>{title}</Text>
      <Text style={styles.small} numberOfLines={1}>{value}</Text>
    </Pressable>
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
  buttons: { flexDirection: 'row', justifyContent: 'space-around', backgroundColor: NAVY, borderRadius: 24, borderCurve: 'continuous', paddingVertical: 16 },
  button: { alignItems: 'center', gap: 4, minWidth: 88 },
  pressed: { opacity: 0.6 },
  round: { width: 52, height: 52, borderRadius: 26, backgroundColor: '#FFFFFF1F', alignItems: 'center', justifyContent: 'center' },
  buttonTitle: { color: '#FFFFFF', fontSize: 15, fontWeight: '600' },
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
