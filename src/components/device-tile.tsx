import * as Haptics from 'expo-haptics';
import { SymbolView, type SFSymbol } from 'expo-symbols';
import type { HassEntities, HassEntity } from 'home-assistant-js-websocket';
import { useIsFocused } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { interpolateColor, useAnimatedStyle, useSharedValue, withSequence, withSpring, withTiming } from 'react-native-reanimated';

import { climateLook } from '@/climate';
import { until, useTimer } from '@/components/device-extras';
import { VACUUM_STATE } from '@/components/device-sheet';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { byDomain, isEcho, name, playerOn, players, switchables, unavailable, useHA, type Device } from '@/ha';
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
  media_player: 'tv.fill',
  climate: 'thermometer.medium',
};
/**
 * Icons you can give a device (Settings in its sheet), like the Kasa app's. Saved as the entity's icon in Home
 * Assistant, so every screen (and Home Assistant itself) shows it; Kasa's own icon never reaches Home Assistant.
 */
export const ICON_CHOICES: { mdi: string; symbol: SFSymbol; label: string }[] = [
  { mdi: 'mdi:lamp', symbol: 'lamp.table.fill', label: 'Lamp' },
  { mdi: 'mdi:floor-lamp', symbol: 'lamp.floor.fill', label: 'Floor lamp' },
  { mdi: 'mdi:desk-lamp', symbol: 'lamp.desk.fill', label: 'Desk lamp' },
  { mdi: 'mdi:ceiling-light', symbol: 'lamp.ceiling.fill', label: 'Ceiling light' },
  { mdi: 'mdi:lightbulb', symbol: 'lightbulb.fill', label: 'Bulb' },
  { mdi: 'mdi:led-strip-variant', symbol: 'light.strip.2.fill', label: 'Light strip' },
  { mdi: 'mdi:string-lights', symbol: 'sparkles', label: 'Decorative' },
  { mdi: 'mdi:pine-tree', symbol: 'tree.fill', label: 'Tree' },
  { mdi: 'mdi:fan', symbol: 'fan.fill', label: 'Fan' },
  { mdi: 'mdi:ceiling-fan', symbol: 'fan.ceiling.fill', label: 'Ceiling fan' },
  { mdi: 'mdi:television', symbol: 'tv.fill', label: 'TV' },
  { mdi: 'mdi:speaker', symbol: 'hifispeaker.fill', label: 'Speaker' },
  { mdi: 'mdi:coffee-maker', symbol: 'cup.and.saucer.fill', label: 'Coffee' },
  { mdi: 'mdi:radiator', symbol: 'heater.vertical.fill', label: 'Heater' },
  { mdi: 'mdi:air-purifier', symbol: 'air.purifier.fill', label: 'Purifier' },
  { mdi: 'mdi:router-wireless', symbol: 'wifi.router.fill', label: 'Router' },
  { mdi: 'mdi:power-socket-us', symbol: 'powerplug.fill', label: 'Plug' },
];

export const GAP = 12;
const AMBER: number[] = [255, 179, 0];

export const domainOf = (e: HassEntity) => e.entity_id.split('.')[0];

/** On, for counting and "All off": a TV that's playing or idle counts too; an Echo never does. */
export const active = (e: HassEntity) => e.state === 'on' || (domainOf(e) === 'media_player' && !isEcho(e) && playerOn(e));

/**
 * Everything the app can control, by name. Switches that belong to a camera (Blink motion detection) live on the
 * Cameras tab, and a thermostat's settings switches (Ecobee's Mute, AirPlay) in its sheet.
 */
export const allDevices = (entities: HassEntities, registry: Record<string, Device>) =>
  [...switchables(entities, registry), ...byDomain(entities, 'vacuum', 'climate'), ...players(entities, registry)].sort((a, b) =>
    name(a).localeCompare(name(b)),
  );

/** Two tiles per row, edge to edge inside the screen padding. */
export const tileWidth = (screenWidth: number) => (screenWidth - Spacing.three * 2 - GAP) / 2;

// The colour a device glows in when on (a light uses its own colour).
const TINT: Record<string, number[]> = { fan: [0, 188, 212], vacuum: [43, 182, 115], media_player: [124, 131, 253] };

/**
 * What a device tile shows and does: on or off (the tapped position until HA confirms), its state line, colour and
 * icon. A thermostat has no on/off tap (`toggle` is undefined): it glows while heating or cooling and opens its sheet.
 */
export function useDevice(entity: HassEntity) {
  const { call } = useHA();
  const { end } = useTimer(entity.entity_id);
  const off = unavailable(entity);
  const vacuum = domainOf(entity) === 'vacuum';
  const media = domainOf(entity) === 'media_player';
  const echo = isEcho(entity);
  const shown = useOptimistic(entity, vacuum ? entity.state === 'cleaning' : echo ? entity.state === 'playing' : active(entity));
  const isOn = shown.isOn;
  const [r, g, b] = (entity.attributes.rgb_color as number[] | undefined) ?? TINT[domainOf(entity)] ?? AMBER;
  const brightness: number | undefined = entity.attributes.brightness;
  const state =
    off ? 'Unavailable'
    : vacuum ? (VACUUM_STATE[entity.state] ?? entity.state)
    : echo ? (isOn ? (entity.attributes.media_title ?? 'Playing') : 'Idle')
    : !isOn ? 'Off'
    : media ? (entity.attributes.app_name ?? (entity.state === 'playing' ? 'Playing' : 'On'))
    : brightness ? `${Math.round(brightness / 2.55)}%`
    : 'On';
  const timer = end ? ` · ⏱ ${until(end)}` : '';
  if (domainOf(entity) === 'climate') {
    const look = climateLook(entity);
    return { off, isOn: !off && look.working, state: off ? 'Unavailable' : look.state, timer, rgb: look.rgb, icon: look.icon, toggle: undefined };
  }

  const toggle = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    // Vacuums have no toggle: tap starts, or pauses while cleaning. An Echo plays or pauses.
    shown.set(!isOn, () =>
      vacuum
        ? call('vacuum', isOn ? 'pause' : 'start', { entity_id: entity.entity_id })
        : echo
        ? call('media_player', 'media_play_pause', { entity_id: entity.entity_id })
        : call(domainOf(entity), isOn ? 'turn_off' : 'turn_on', { entity_id: entity.entity_id }),
    );
  };
  const chosen = ICON_CHOICES.find((c) => c.mdi === entity.attributes.icon)?.symbol;
  const icon: SFSymbol = chosen ?? (echo ? 'homepod.fill' : (ICONS[domainOf(entity)] ?? 'power'));
  return { off, isOn, state, timer, rgb: [r, g, b], icon, toggle };
}

/**
 * A device, Home Assistant style: tap the icon to switch it, tap the rest for its settings. The icon flips the moment
 * it's tapped and fades between colours; a change made elsewhere (Alexa, a schedule) gives a light tap while you look.
 */
export function Tile({ entity, width, onSettings }: { entity: HassEntity; width: number; onSettings: () => void }) {
  const theme = useTheme();
  const { off, isOn, state, timer, rgb: [r, g, b], icon, toggle: flip } = useDevice(entity);
  const reading: number | undefined = domainOf(entity) === 'climate' && !off ? entity.attributes.current_temperature : undefined;

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
  const onBg = `rgba(${r},${g},${b},0.2)`;
  const iconStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(progress.value, [0, 1], [theme.backgroundSelected, onBg]),
    transform: [{ scale: pop.value }],
  }));

  const toggle = () => {
    tapped.current = true;
    flip?.();
  };

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${name(entity)}, ${state}`}
      accessibilityHint="Opens timers, schedules and settings"
      onPress={onSettings}
      style={({ pressed }) => [styles.tile, { width, backgroundColor: theme.backgroundElement }, pressed && styles.pressed]}>
      <Pressable
        disabled={off}
        accessibilityRole={flip ? 'switch' : 'button'}
        accessibilityLabel={name(entity)}
        accessibilityState={flip ? { checked: isOn, disabled: off } : { disabled: off }}
        hitSlop={8}
        onPress={flip ? toggle : onSettings}>
        <Animated.View style={[styles.icon, iconStyle, off && styles.dim]}>
          {reading != null ? (
            // A thermostat shows the temperature instead of an icon.
            <ThemedText style={[styles.reading, { color: isOn ? `rgb(${r},${g},${b})` : theme.text }]}>{Math.round(reading)}°</ThemedText>
          ) : (
            <SymbolView
              name={icon}
              size={18}
              tintColor={isOn ? `rgb(${r},${g},${b})` : theme.textSecondary}
            />
          )}
        </Animated.View>
      </Pressable>
      <View style={styles.text}>
        <ThemedText type="small" numberOfLines={1} style={styles.tileName}>
          {name(entity)}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary" numberOfLines={1} style={styles.state}>
          {state}
          {timer}
        </ThemedText>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tile: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 14, paddingHorizontal: 12, minHeight: 64 },
  reading: { fontSize: 14, fontWeight: '700', fontVariant: ['tabular-nums'] },
  icon: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  text: { flex: 1 },
  tileName: { fontWeight: '600', lineHeight: 18 },
  state: { fontSize: 13, lineHeight: 17 },
  dim: { opacity: 0.45 },
  pressed: { opacity: 0.7 },
});
