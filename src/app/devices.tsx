import type { HassEntity } from 'home-assistant-js-websocket';
import { useState } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';

import { AddDeviceSheet } from '@/components/add-device';
import { Chip } from '@/components/chip';
import { active, allDevices, GAP, Tile, tileWidth } from '@/components/device-tile';
import { DeviceSheet } from '@/components/device-sheet';
import { SceneList } from '@/components/scene-list';
import { Card, Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useHA } from '@/ha';
import { useDiscovered } from '@/setup';

const OTHER = 'Other';

// Every device by room, then scenes. Home shows only the favourites.
export default function DevicesScreen() {
  const { entities, areas, devices: registry, status, call } = useHA();
  const [detail, setDetail] = useState<string>();
  const [setUp, setSetUp] = useState<string>();
  const discovered = useDiscovered();
  const { width } = useWindowDimensions();

  const devices = allDevices(entities, registry);
  const on = devices.filter(active);

  const rooms: Record<string, HassEntity[]> = {};
  for (const e of devices) (rooms[areas[e.entity_id] ?? OTHER] ??= []).push(e);
  const roomNames = Object.keys(rooms).sort((a, b) => (a === OTHER ? 1 : b === OTHER ? -1 : a.localeCompare(b)));

  return (
    <Screen
      title="Devices"
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

      {roomNames.map((room) => (
        <View key={room} style={styles.section}>
          <ThemedText type="smallBold" themeColor="textSecondary">
            {roomNames.length === 1 && room === OTHER ? 'Devices' : room}
          </ThemedText>
          <View style={styles.grid}>
            {rooms[room].map((e) => (
              <Tile key={e.entity_id} entity={e} width={tileWidth(width)} onSettings={() => setDetail(e.entity_id)} />
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
          Tap an icon to switch it · tap a name for timers, schedules and ☆ favourite
        </ThemedText>
      )}

      <SceneList />

      {setUp && <AddDeviceSheet start={{ flowId: setUp }} onClose={() => setSetUp(undefined)} />}
      {detail && entities[detail] && <DeviceSheet entity={entities[detail]} onClose={() => setDetail(undefined)} />}
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  found: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  section: { gap: Spacing.two },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: GAP },
  hint: { textAlign: 'center' },
});
