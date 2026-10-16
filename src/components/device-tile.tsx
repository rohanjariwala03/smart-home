import * as Haptics from 'expo-haptics';
import { SymbolView, type SFSymbol } from 'expo-symbols';
import type { HassEntities, HassEntity } from 'home-assistant-js-websocket';
import { Pressable, StyleSheet, View } from 'react-native';

import { until, useTimer } from '@/components/device-extras';
import { VACUUM_STATE } from '@/components/device-sheet';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { byDomain, name, switchables, unavailable, useHA, type Device } from '@/ha';
import { useTheme } from '@/hooks/use-theme';

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

/** A device you tap to switch on or off; the gear (or a long press) opens its settings. */
export function Tile({ entity, width, onSettings }: { entity: HassEntity; width: number; onSettings: () => void }) {
  const { call } = useHA();
  const { end } = useTimer(entity.entity_id);
  const theme = useTheme();
  const off = unavailable(entity);
  const vacuum = domainOf(entity) === 'vacuum';
  const isOn = entity.state === (vacuum ? 'cleaning' : 'on');
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

  return (
    <Pressable
      disabled={off}
      accessibilityRole="switch"
      accessibilityLabel={name(entity)}
      accessibilityState={{ checked: isOn, disabled: off }}
      accessibilityHint="Hold for timers, schedules and settings"
      onPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        // Vacuums have no toggle: tap starts, or pauses while cleaning.
        if (vacuum) call('vacuum', isOn ? 'pause' : 'start', { entity_id: entity.entity_id });
        else call(domainOf(entity), 'toggle', { entity_id: entity.entity_id });
      }}
      onLongPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        onSettings();
      }}
      style={({ pressed }) => [
        styles.tile,
        { width, backgroundColor: isOn ? `rgba(${r},${g},${b},0.28)` : theme.backgroundElement },
        off && styles.dim,
        pressed && styles.pressed,
      ]}>
      <View style={styles.tileTop}>
        <View style={[styles.icon, { backgroundColor: isOn ? `rgb(${r},${g},${b})` : theme.backgroundSelected }]}>
          <SymbolView
            name={ICONS[domainOf(entity)] ?? 'power'}
            size={20}
            tintColor={isOn ? (darkTint ? '#fff' : '#000') : theme.textSecondary}
          />
        </View>
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
