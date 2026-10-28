import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import type { HassEntity } from 'home-assistant-js-websocket';
import { useRef, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View, type ViewStyle } from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';

import { Chip } from '@/components/chip';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useHA } from '@/ha';
import { useTheme } from '@/hooks/use-theme';

// A light's colour the way the Govee app picks it: a wheel to drag, whites from warm to cool, and its scenes.
// The images come from scripts/make-colour-images.py: hue runs clockwise from red at 3 o'clock, white at the centre.

const WHEEL = require('@/assets/images/colour-wheel.png');
const STRIP = require('@/assets/images/white-strip.png');
const STRIP_K = [2000, 9000];

const PRESETS: [number, number][] = [
  [0, 100], [20, 100], [35, 100], [55, 100], [100, 100], [160, 100],
  [190, 100], [220, 100], [250, 100], [275, 100], [300, 100], [330, 100],
];
const WHITES: [string, number][] = [['Warm', 2700], ['Neutral', 4000], ['Daylight', 5000], ['Cool', 6500]];
const SEND_EVERY = 400; // ms while dragging; the Govee cloud rate-limits

/** Tanner Helland's kelvin → RGB approximation (same as the script's). */
export function kelvinRgb(k: number) {
  const t = k / 100;
  const r = t <= 66 ? 255 : 329.698727446 * (t - 60) ** -0.1332047592;
  const g = t <= 66 ? 99.4708025861 * Math.log(t) - 161.1195681661 : 288.1221695283 * (t - 60) ** -0.0755148492;
  const b = t >= 66 ? 255 : t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  return [r, g, b].map((c) => Math.round(Math.min(255, Math.max(0, c))));
}
const hsl = ([h, s]: [number, number]) => `hsl(${h}, 100%, ${100 - s / 2}%)`;

/** Calls `send` at most every SEND_EVERY ms while dragging, and always with the last value. */
function useThrottle<T>(send: (v: T) => void) {
  const last = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  return (v: T, final = false) => {
    clearTimeout(timer.current);
    const wait = final ? 0 : last.current + SEND_EVERY - Date.now();
    if (wait <= 0) {
      last.current = Date.now();
      send(v);
    } else timer.current = setTimeout(() => ((last.current = Date.now()), send(v)), wait);
  };
}

/** A view that follows the finger from the first touch, so the sheet doesn't scroll or close instead (as the thermostat's). */
function DragArea({ onMove, style, children, ...a11y }: {
  onMove: (x: number, y: number, final: boolean) => void;
  style: ViewStyle;
  children: React.ReactNode;
} & React.ComponentProps<typeof View>) {
  const pan = Gesture.Pan()
    .runOnJS(true)
    .minDistance(0)
    .onBegin((e) => onMove(e.x, e.y, false))
    .onUpdate((e) => onMove(e.x, e.y, false))
    .onEnd((e) => onMove(e.x, e.y, true));
  return (
    <GestureHandlerRootView style={style}>
      <GestureDetector gesture={pan}>
        <View style={StyleSheet.absoluteFill} {...a11y}>{children}</View>
      </GestureDetector>
    </GestureHandlerRootView>
  );
}

export function LightColour({ entity }: { entity: HassEntity }) {
  const { call } = useHA();
  const a = entity.attributes;
  const modes: string[] = a.supported_color_modes ?? [];
  const colour = modes.some((m) => ['hs', 'rgb', 'rgbw', 'rgbww', 'xy'].includes(m));
  const white = modes.includes('color_temp');
  const scenes: string[] = a.effect_list ?? [];
  const tabs = [colour && 'Colour', white && 'White', scenes.length > 0 && 'Scenes'].filter((t): t is string => !!t);
  const [tab, setTab] = useState(a.color_mode === 'color_temp' && white ? 'White' : tabs[0]);
  if (!tabs.length) return null;

  const turnOn = (data: object) => call('light', 'turn_on', { entity_id: entity.entity_id, ...data });
  return (
    <View style={styles.gap}>
      {tabs.length > 1 && (
        <View style={styles.wrap}>
          {tabs.map((t) => <Chip key={t} label={t} selected={tab === t} onPress={() => setTab(t)} />)}
        </View>
      )}
      {tab === 'Colour' && <Wheel entity={entity} turnOn={turnOn} />}
      {tab === 'White' && <Whites entity={entity} turnOn={turnOn} />}
      {tab === 'Scenes' && <Scenes scenes={scenes} current={a.effect} pick={(effect) => turnOn({ effect })} />}
    </View>
  );
}

type TurnOn = (data: object) => unknown;

function Wheel({ entity, turnOn }: { entity: HassEntity; turnOn: TurnOn }) {
  const theme = useTheme();
  const [size, setSize] = useState(0);
  const [picked, setPicked] = useState<[number, number]>();
  const send = useThrottle((hs: [number, number]) => turnOn({ hs_color: hs }));
  const fromLight = entity.attributes.color_mode !== 'color_temp' ? entity.attributes.hs_color : undefined;
  const hs: [number, number] | undefined = picked ?? fromLight;
  const r = size / 2;

  const onMove = (x: number, y: number, final: boolean) => {
    const dx = x - r, dy = y - r;
    const next: [number, number] = [Math.round((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360, Math.round(Math.min(1, Math.hypot(dx, dy) / r) * 100)];
    setPicked(next);
    send(next, final);
    if (final) Haptics.selectionAsync();
  };
  const pick = (next: [number, number]) => {
    setPicked(next);
    send(next, true);
  };

  return (
    <>
      <View style={styles.center} onLayout={(e) => setSize(Math.min(e.nativeEvent.layout.width, 300))}>
        {size > 0 && (
          <DragArea
            onMove={onMove}
            style={{ width: size, height: size }}
            accessible
            accessibilityRole="adjustable"
            accessibilityLabel="Colour wheel"
            accessibilityValue={hs ? { text: `Hue ${hs[0]} degrees, ${hs[1]}% saturated` } : undefined}
            accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
            onAccessibilityAction={(e) => pick([((hs?.[0] ?? 0) + (e.nativeEvent.actionName === 'increment' ? 30 : 330)) % 360, 100])}>
            <Image source={WHEEL} style={StyleSheet.absoluteFill} pointerEvents="none" />
            {hs && (
              <View
                pointerEvents="none"
                style={[
                  styles.thumb,
                  { borderColor: theme.backgroundElement, backgroundColor: hsl(hs) },
                  { left: r + Math.cos((hs[0] * Math.PI) / 180) * (hs[1] / 100) * r - 16, top: r + Math.sin((hs[0] * Math.PI) / 180) * (hs[1] / 100) * r - 16 },
                ]}
              />
            )}
          </DragArea>
        )}
      </View>
      <View style={styles.presets}>
        {PRESETS.map((p) => (
          <Pressable
            key={p.join()}
            accessibilityRole="button"
            accessibilityLabel={`Hue ${p[0]} degrees`}
            onPress={() => pick(p)}
            style={({ pressed }) => [styles.preset, { backgroundColor: hsl(p) }, hs?.[0] === p[0] && hs?.[1] === p[1] && styles.presetOn, pressed && styles.pressed]}
          />
        ))}
      </View>
    </>
  );
}

function Whites({ entity, turnOn }: { entity: HassEntity; turnOn: TurnOn }) {
  const a = entity.attributes;
  const theme = useTheme();
  const minK: number = a.min_color_temp_kelvin ?? 2000;
  const maxK: number = a.max_color_temp_kelvin ?? 6500;
  const [w, setW] = useState(0);
  const [picked, setPicked] = useState<number>();
  const send = useThrottle((k: number) => turnOn({ color_temp_kelvin: k }));
  const k = picked ?? (a.color_mode === 'color_temp' ? a.color_temp_kelvin : undefined);
  const clamp = (v: number) => Math.round(Math.min(maxK, Math.max(minK, v)) / 50) * 50;
  // The strip image spans 2000–9000 K; show only this light's part of it.
  const from = (minK - STRIP_K[0]) / (STRIP_K[1] - STRIP_K[0]);
  const to = (maxK - STRIP_K[0]) / (STRIP_K[1] - STRIP_K[0]);

  const onMove = (x: number, _y: number, final: boolean) => {
    if (!w) return;
    const next = clamp(minK + (Math.min(w, Math.max(0, x)) / w) * (maxK - minK));
    setPicked(next);
    send(next, final);
    if (final) Haptics.selectionAsync();
  };
  const pick = (v: number) => {
    setPicked(clamp(v));
    send(clamp(v), true);
  };

  return (
    <>
      <View style={styles.row}>
        <ThemedText type="small" themeColor="textSecondary">Warm</ThemedText>
        <ThemedText type="smallBold">{k ? `${k} K` : 'Pick a white'}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">Cool</ThemedText>
      </View>
      <View onLayout={(e) => setW(e.nativeEvent.layout.width)} />
      <DragArea
        onMove={onMove}
        style={styles.strip}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel="White, warm to cool"
        accessibilityValue={k ? { text: `${k} kelvin` } : undefined}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(e) => pick((k ?? 4000) + (e.nativeEvent.actionName === 'increment' ? 500 : -500))}>
        {w > 0 && (
          <Image
            source={STRIP}
            pointerEvents="none"
            contentFit="fill"
            style={{ position: 'absolute', top: 0, bottom: 0, width: w / (to - from), left: (-from * w) / (to - from) }}
          />
        )}
        {k != null && w > 0 && (
          <View pointerEvents="none" style={[styles.stripThumb, { borderColor: theme.backgroundElement, left: Math.min(w - 30, Math.max(2, ((k - minK) / (maxK - minK)) * w - 14)), backgroundColor: `rgb(${kelvinRgb(k).join()})` }]} />
        )}
      </DragArea>
      <View style={styles.whites}>
        {WHITES.filter(([, v]) => v >= minK - 200 && v <= maxK + 200).map(([label, v]) => (
          <Pressable key={label} accessibilityRole="button" accessibilityLabel={`${label} white`} onPress={() => pick(v)} style={({ pressed }) => [styles.white, pressed && styles.pressed]}>
            <View style={[styles.preset, { backgroundColor: `rgb(${kelvinRgb(v).join()})` }, k === clamp(v) && styles.presetOn]} />
            <ThemedText type="small" themeColor="textSecondary">{label}</ThemedText>
          </Pressable>
        ))}
      </View>
    </>
  );
}

function Scenes({ scenes, current, pick }: { scenes: string[]; current?: string; pick: (s: string) => void }) {
  const theme = useTheme();
  const [q, setQ] = useState('');
  const shown = q ? scenes.filter((s) => s.toLowerCase().includes(q.toLowerCase())) : scenes;
  return (
    <>
      {scenes.length > 12 && (
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder={`Search ${scenes.length} scenes`}
          placeholderTextColor={theme.textSecondary}
          clearButtonMode="while-editing"
          autoCorrect={false}
          style={[styles.search, { color: theme.text, backgroundColor: theme.backgroundSelected }]}
        />
      )}
      <View style={styles.wrap}>
        {shown.map((s) => <Chip key={s} label={s} selected={s === current} onPress={() => pick(s)} />)}
        {!shown.length && <ThemedText themeColor="textSecondary">No scene called “{q}”.</ThemedText>}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  gap: { gap: Spacing.three },
  center: { alignItems: 'center' },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  pressed: { opacity: 0.7 },
  thumb: { position: 'absolute', width: 32, height: 32, borderRadius: 16, borderWidth: 4, shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 4, shadowOffset: { width: 0, height: 1 } },
  presets: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 12 },
  preset: { width: 36, height: 36, borderRadius: 18, borderWidth: 1, borderColor: '#8884' },
  presetOn: { borderWidth: 3, borderColor: '#0A84FF' },
  strip: { height: 44, borderRadius: 22, overflow: 'hidden', justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth, borderColor: '#8886' },
  stripThumb: { position: 'absolute', top: 8, width: 28, height: 28, borderRadius: 14, borderWidth: 4, shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 4 },
  whites: { flexDirection: 'row', justifyContent: 'space-around' },
  white: { alignItems: 'center', gap: 6 },
  search: { borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16 },
});
