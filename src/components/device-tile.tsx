import * as Haptics from 'expo-haptics';
import { SymbolView, type SFSymbol } from 'expo-symbols';
import type { HassEntities, HassEntity } from 'home-assistant-js-websocket';
import { useIsFocused } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { interpolateColor, useAnimatedStyle, useSharedValue, withSequence, withSpring, withTiming } from 'react-native-reanimated';

import { until, useTimer } from '@/components/device-extras';
import { VACUUM_STATE } from '@/components/device-sheet';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { byDomain, name, switchables, unavailable, useHA, type Device } from '@/ha';
import { useTheme } from '@/hooks/use-theme';
import { useOptimistic } from '@/optimistic';

export const ICONS: Record<string, SFSymbol> = {
  light: 'lightbulb.fill',
  switch: 'power',
  fan: 'fan.fill',
  input_boolean: 'togglepower',
  scene: 'sparkles',
  script: 'play.fill',
  vacuum: 'robotic.vacuum.fill',
};
export const GAP = 12;
const YELLOW: number[] = [255, 214, 10];

export const domainOf = (e: HassEntity) => e.entity_id.split('.')[0];

/** Everything the app can switch, by name. Switches that belong to a camera (Blink motion detection) live on the Cameras tab instead. */
export const allDevices = (entities: HassEntities, registry: Record<string, Device>) =>
  [...switchables(entities, registry), ...byDomain(entities, 'vacuum')].sort((a, b) => name(a).localeCompare(name(b)));

/** Two tiles per row, edge to edge inside the screen padding. */
export const tileWidth = (screenWidth: number) => (screenWidth - Spacing.three * 2 - GAP) / 2;

/**
 * A device you tap to switch on or off; the gear (or a long press) opens its settings. Flips the moment it's tapped
 * and fades between colours. A change made elsewhere (Alexa, a schedule) gives a light tap while you're looking.
 */
export function Tile({ entity, width, onSettings }: { entity: HassEntity; width: number; onSettings: () => void }) {
  const { call } = useHA();
  const { end } = useTimer(entity.entity_id);
  const theme = useTheme();
  const off = unavailable(entity);
  const vacuum = domainOf(entity) === 'vacuum';
  const shown = useOptimistic(entity, entity.state === (vacuum ? 'cleaning' : 'on'));
  const isOn = shown.isOn;
  const [r, g, b] = (entity.attributes.rgb_color as number[] | undefined) ?? YELLOW;
  const darkTint = 0.299 * r + 0.587 * g + 0.114 * b < 150;
  const brightness: number | undefined = entity.attributes.brightness;
  const state =
    off ? 'Unavailable'
    : vacuum ? (VACUUM_STATE[entity.state] ?? entity.state)
    : !isOn ? 'Off'
    : brightness ? `On · ${Math.round(brightness / 2.55)}%`
    : 'On';
  const timer = end ? ` · ⏱ ${until(end)}` : '';

  const onBg = `rgba(${r},${g},${b},0.28)`;
  const progress = useSharedValue(isOn ? 1 : 0);
  const pop = useSharedValue(1);
  const focused = useIsFocused();
  const tapped = useRef(false);
  const was = useRef(isOn);
  useEffect(() => {
    if (was.current === isOn) return;
    was.current = isOn;
    progress.set(withTiming(isOn ? 1 : 0, { duration: 250 }));
    pop.set(withSequence(withTiming(1.15, { duration: 120 }), withSpring(1)));
    if (!tapped.current && focused) Haptics.selectionAsync();
    tapped.current = false;
  }, [isOn, focused, progress, pop]);
  const bg = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(progress.value, [0, 1], [theme.backgroundElement, onBg]),
  }));
  const iconPop = useAnimatedStyle(() => ({ transform: [{ scale: pop.value }] }));

  return (
    <Pressable
      disabled={off}
      accessibilityRole="switch"
      accessibilityLabel={name(entity)}
      accessibilityState={{ checked: isOn, disabled: off }}
      accessibilityHint="Hold for timers, schedules and settings"
      onPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        tapped.current = true;
        // Vacuums have no toggle: tap starts, or pauses while cleaning.
        shown.set(!isOn, () =>
          vacuum
            ? call('vacuum', isOn ? 'pause' : 'start', { entity_id: entity.entity_id })
            : call(domainOf(entity), isOn ? 'turn_off' : 'turn_on', { entity_id: entity.entity_id }),
        );
      }}
      onLongPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        onSettings();
      }}
      style={({ pressed }) => [{ width }, off && styles.dim, pressed && styles.pressed]}>
      <Animated.View style={[styles.tile, bg]}>
        <View style={styles.tileTop}>
          <Animated.View style={[styles.icon, { backgroundColor: isOn ? `rgb(${r},${g},${b})` : theme.backgroundSelected }, iconPop]}>
            <SymbolView
              name={ICONS[domainOf(entity)] ?? 'power'}
              size={20}
              tintColor={isOn ? (darkTint ? '#fff' : '#000') : theme.textSecondary}
            />
          </Animated.View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${name(entity)} settings`}
            hitSlop={12}
            onPress={onSettings}
            style={styles.gear}>
            <SymbolView name="gearshape.fill" size={18} tintColor={theme.textSecondary} />
          </Pressable>
        </View>
        <View>
          <ThemedText numberOfLines={1} style={styles.tileName}>
            {name(entity)}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
            {state}
            {timer}
          </ThemedText>
        </View>
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tile: { borderRadius: 20, padding: 14, gap: Spacing.three, minHeight: 112, justifyContent: 'space-between' },
  tileTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  gear: { padding: 4 },
  icon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  tileName: { fontWeight: '600' },
  dim: { opacity: 0.45 },
  pressed: { opacity: 0.7, transform: [{ scale: 0.97 }] },
});
