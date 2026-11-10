import * as Haptics from 'expo-haptics';
import { SymbolView, type SFSymbol } from 'expo-symbols';
import type { HassEntities, HassEntity } from 'home-assistant-js-websocket';
import { useIsFocused } from 'expo-router';
import { useEffect, useRef, type ElementRef } from 'react';
import { ActionSheetIOS, Alert, findNodeHandle, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, {
  interpolateColor,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { removeAutomation, setTimer, timerId } from '@/automations';
import { climateLook } from '@/climate';
import { tintOf, useIconMotion } from '@/components/icon-motion';
import { until, useTimer } from '@/components/device-extras';
import { VACUUM_STATE } from '@/components/device-sheet';
import { MAX_SCALE, ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useFavourites } from '@/favourites';
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

/**
 * As many tiles of at least 200 pt as fit (two on a phone, three to five on an iPad), edge to edge inside the padding.
 * Larger text (Settings › Accessibility) widens them, down to one per row on a phone.
 */
export const tileWidth = (screenWidth: number, fontScale = 1) => {
  const inner = screenWidth - Spacing.three * 2;
  const min = 200 * Math.min(Math.max(fontScale, 1), MAX_SCALE);
  const columns = Math.max(fontScale > 1.3 ? 1 : 2, Math.floor((inner + GAP) / (min + GAP)));
  return Math.floor((inner - GAP * (columns - 1)) / columns); // whole points, or rounding can push the last one to a new row
};

/** "All off", with a success tap once Home Assistant has done it. */
export const allOff = (call: (domain: string, service: string, data: object) => Promise<boolean>, on: HassEntity[]) =>
  call('homeassistant', 'turn_off', { entity_id: on.map((e) => e.entity_id) }).then((ok) => {
    if (ok) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  });

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
  const chosen = ICON_CHOICES.find((c) => c.mdi === entity.attributes.icon)?.symbol;
  const icon: SFSymbol = chosen ?? (echo ? 'homepod.fill' : (ICONS[domainOf(entity)] ?? 'power'));
  const [r, g, b] = (entity.attributes.rgb_color as number[] | undefined) ?? tintOf(icon) ?? AMBER;
  const brightness: number | undefined = entity.attributes.brightness;
  const state =
    off ? 'Unavailable'
    : vacuum ? (VACUUM_STATE[entity.state] ?? entity.state)
    : echo ? (isOn ? (entity.attributes.media_title ?? 'Playing') : 'Idle')
    : shown.waiting && !media ? (isOn ? 'Turning on…' : 'Turning off…')
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
  const lines = useWindowDimensions().fontScale > 1.3 ? 2 : 1; // long names wrap once text is large
  const { style: motion } = useIconMotion(icon, entity, isOn);

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
  const tile = useRef<ElementRef<typeof Pressable>>(null);
  const menu = useTileMenu(entity, isOn, flip && toggle, onSettings, tile);

  return (
    <Pressable
      ref={tile}
      accessibilityRole="button"
      accessibilityLabel={`${name(entity)}, ${state}`}
      accessibilityHint="Opens timers, schedules and settings"
      onPress={onSettings}
      onLongPress={menu}
      accessibilityActions={[{ name: 'longpress', label: 'More options' }]}
      onAccessibilityAction={menu}
      style={({ pressed }) => [styles.tile, { width, backgroundColor: theme.backgroundElement }, pressed && styles.pressed]}>
      <Pressable
        disabled={off}
        accessibilityRole={flip ? 'switch' : 'button'}
        accessibilityLabel={name(entity)}
        accessibilityState={flip ? { checked: isOn, disabled: off } : { disabled: off }}
        hitSlop={8}
        onLongPress={menu}
        onPress={flip ? toggle : onSettings}>
        <Animated.View style={[styles.icon, iconStyle, off && styles.dim]}>
          {reading != null ? (
            // A thermostat shows the temperature instead of an icon.
            <ThemedText style={[styles.reading, { color: isOn ? `rgb(${r},${g},${b})` : theme.text }]}>{Math.round(reading)}°</ThemedText>
          ) : (
            <Animated.View style={motion}>
              <SymbolView name={icon} size={18} tintColor={isOn ? `rgb(${r},${g},${b})` : theme.textSecondary} />
            </Animated.View>
          )}
        </Animated.View>
      </Pressable>
      <View style={styles.text}>
        <ThemedText type="small" numberOfLines={lines} style={styles.tileName}>
          {name(entity)}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary" numberOfLines={lines} style={styles.state}>
          {state}
          {timer}
        </ThemedText>
      </View>
    </Pressable>
  );
}

/** Hold a tile for a menu: switch it, a quick timer, pin it to Home, or its settings. */
function useTileMenu(entity: HassEntity, isOn: boolean, toggle: (() => void) | undefined, onSettings: () => void, anchor: { current: unknown }) {
  const { creds } = useHA();
  const { end } = useTimer(entity.entity_id);
  const { isFavourite, toggle: pin } = useFavourites();
  const id = entity.entity_id;
  // The same devices whose sheet has a Timer card.
  const timed = !!creds && (['light', 'switch', 'fan', 'input_boolean'].includes(domainOf(entity)) || (domainOf(entity) === 'media_player' && !isEcho(entity)));
  const verb = isOn ? 'Turn off' : 'Turn on';
  const failed = (e: any) => Alert.alert('Timer failed', e?.message ?? String(e));
  const timer = (min: number) => () => creds && setTimer(creds, id, name(entity), !isOn, new Date(Date.now() + min * 60e3)).catch(failed);
  const items: [string, (() => unknown) | false | undefined][] = [
    [verb, toggle],
    [end ? `Cancel timer (${until(end)} left)` : '', timed && !!end && (() => creds && removeAutomation(creds, timerId(id)).catch(failed))],
    [`${verb} in 30 min`, timed && !end && timer(30)],
    [`${verb} in 1 hour`, timed && !end && timer(60)],
    [isFavourite(id) ? 'Remove from Home' : 'Add to Home', () => pin(id)],
    ['Settings', onSettings],
  ];
  return () => {
    const shown = items.filter(([, run]) => run) as [string, () => unknown][];
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    ActionSheetIOS.showActionSheetWithOptions(
      { title: name(entity), options: [...shown.map(([label]) => label), 'Cancel'], cancelButtonIndex: shown.length, anchor: findNodeHandle(anchor.current as never) ?? undefined },
      (i) => shown[i]?.[1](),
    );
  };
}

/** Grey tiles while the first states load, gently pulsing (still with Reduce Motion on). */
export function Placeholders({ count, width }: { count: number; width: number }) {
  const theme = useTheme();
  const still = useReducedMotion();
  const pulse = useSharedValue(1);
  useEffect(() => {
    if (!still) pulse.set(withRepeat(withTiming(0.4, { duration: 800 }), -1, true));
  }, [still, pulse]);
  const style = useAnimatedStyle(() => ({ opacity: pulse.value }));
  return Array.from({ length: count }, (_, i) => (
    <Animated.View key={i} accessibilityElementsHidden style={[styles.tile, { width, backgroundColor: theme.backgroundElement }, style]} />
  ));
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
