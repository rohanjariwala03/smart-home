import * as Haptics from 'expo-haptics';
import { SymbolView, type SFSymbol } from 'expo-symbols';
import type { HassEntity } from 'home-assistant-js-websocket';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';

import { AddDeviceSheet } from '@/components/add-device';
import { CameraStrip } from '@/components/camera-strip';
import { Chip } from '@/components/chip';
import { until, useTimer } from '@/components/device-extras';
import { DeviceSheet, VACUUM_STATE } from '@/components/device-sheet';
import { Card, Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { byDomain, name, switchables, unavailable, useHA } from '@/ha';
import { useTheme } from '@/hooks/use-theme';
import { runScene } from '@/scenes';
import { useDiscovered } from '@/setup';

const ICONS: Record<string, SFSymbol> = {
  light: 'lightbulb.fill',
  switch: 'power',
  fan: 'fan.fill',
  input_boolean: 'togglepower',
  scene: 'sparkles',
  script: 'play.fill',
  vacuum: 'robotic.vacuum.fill',
};
const GAP = 12;
const YELLOW: number[] = [255, 214, 10];
const OTHER = 'Other';

const domainOf = (e: HassEntity) => e.entity_id.split('.')[0];

function greeting() {
  const h = new Date().getHours();
  return h < 5 ? 'Good night' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

export default function HomeScreen() {
  const { conn, entities, areas, devices: registry, status, call } = useHA();
  const [detail, setDetail] = useState<string>();
  const [setUp, setSetUp] = useState<string>();
  const discovered = useDiscovered();
  const { width } = useWindowDimensions();
  const tileWidth = (width - Spacing.three * 2 - GAP) / 2;

  // Switches that belong to a camera (Blink motion detection) live on the Cameras tab instead.
  const devices = [...switchables(entities, registry), ...byDomain(entities, 'vacuum')].sort((a, b) =>
    name(a).localeCompare(name(b)),
  );
  const scenes = byDomain(entities, 'scene', 'script');
  const on = devices.filter((e) => e.state === 'on');

  const rooms: Record<string, HassEntity[]> = {};
  for (const e of devices) (rooms[areas[e.entity_id] ?? OTHER] ??= []).push(e);
  const roomNames = Object.keys(rooms).sort((a, b) => (a === OTHER ? 1 : b === OTHER ? -1 : a.localeCompare(b)));

  return (
    <Screen
      title={greeting()}
      subtitle={devices.length ? `${on.length} of ${devices.length} on` : undefined}
      action={
        on.length > 0 && (
          <Chip
            icon="power"
            label="All off"
            onPress={() => call('homeassistant', 'turn_off', { entity_id: on.map((e) => e.entity_id) })}
          />
        )
      }>
      {discovered.length > 0 && (
        <Card>
          <ThemedText type="smallBold">New device found</ThemedText>
          <View style={styles.found}>
            <ThemedText style={styles.flex} numberOfLines={2}>
              {discovered[0].title}
              {discovered.length > 1 ? ` and ${discovered.length - 1} more (see Settings)` : ''}
            </ThemedText>
            <Chip icon="plus" label="Set up" onPress={() => setSetUp(discovered[0].flow.flow_id)} />
          </View>
        </Card>
      )}

      <CameraStrip />

      {scenes.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          {scenes.map((s) => (
            <Chip
              key={s.entity_id}
              icon={ICONS[domainOf(s)]}
              label={name(s)}
              onPress={() => conn && runScene(conn, s.entity_id).catch((e) => Alert.alert('Scene failed', e?.message ?? String(e)))}
            />
          ))}
        </ScrollView>
      )}

      {roomNames.map((room) => (
        <View key={room} style={styles.section}>
          <ThemedText type="smallBold" themeColor="textSecondary">
            {roomNames.length === 1 && room === OTHER ? 'Devices' : room}
          </ThemedText>
          <View style={styles.grid}>
            {rooms[room].map((e) => (
              <Tile
                key={e.entity_id}
                entity={e}
                width={tileWidth}
                onSettings={() => setDetail(e.entity_id)}
              />
            ))}
          </View>
        </View>
      ))}

      {status === 'ready' && devices.length === 0 && (
        <ThemedText themeColor="textSecondary">
          No devices yet. Add them in Home Assistant and they appear here automatically.
        </ThemedText>
      )}
      {devices.length > 0 && (
        <ThemedText type="small" themeColor="textSecondary" style={styles.hint}>
          Tap to switch on or off · ⚙︎ or hold for timers, schedules and more
        </ThemedText>
      )}

      {setUp && <AddDeviceSheet start={{ flowId: setUp }} onClose={() => setSetUp(undefined)} />}
      {detail && entities[detail] && <DeviceSheet entity={entities[detail]} onClose={() => setDetail(undefined)} />}
    </Screen>
  );
}

function Tile({ entity, width, onSettings }: { entity: HassEntity; width: number; onSettings: () => void }) {
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
  flex: { flex: 1 },
  found: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  chips: { gap: Spacing.two },
  section: { gap: Spacing.two },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: GAP },
  tile: { borderRadius: 20, padding: 14, gap: Spacing.three, minHeight: 112, justifyContent: 'space-between' },
  tileTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  gear: { padding: 4 },
  icon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  tileName: { fontWeight: '600' },
  dim: { opacity: 0.45 },
  pressed: { opacity: 0.7, transform: [{ scale: 0.97 }] },
  hint: { textAlign: 'center' },
});
