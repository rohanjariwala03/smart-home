import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';

import { CameraStrip } from '@/components/camera-strip';
import { Chip } from '@/components/chip';
import { active, allDevices, domainOf, GAP, ICONS, Tile, tileWidth } from '@/components/device-tile';
import { DeviceSheet } from '@/components/device-sheet';
import { FavouritesSheet } from '@/components/favourites-sheet';
import { Card, Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Wall } from '@/components/wall';
import { Spacing } from '@/constants/theme';
import { useFavourites } from '@/favourites';
import { name, useHA } from '@/ha';
import { isPad } from '@/orientation';
import { runScene } from '@/scenes';

function greeting() {
  const h = new Date().getHours();
  return h < 5 ? 'Good night' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

// The iPad gets a wall dashboard; the phone, its favourites list.
export default function Home() {
  return isPad ? <Wall /> : <HomeScreen />;
}

// Only what you've starred: cameras, scenes and devices. Everything else is on the Devices and Cameras tabs.
function HomeScreen() {
  const { conn, entities, devices: registry } = useHA();
  const { favourites } = useFavourites();
  const [detail, setDetail] = useState<string>();
  const [editing, setEditing] = useState(false);
  const { width } = useWindowDimensions();

  const on = allDevices(entities, registry).filter(active).length;
  const pinned = (favourites ?? []).flatMap((id) => (entities[id] ? [entities[id]] : []));
  const cameras = pinned.filter((e) => e.attributes.snapshot_of).map((e) => e.entity_id);
  const scenes = pinned.filter((e) => ['scene', 'script'].includes(domainOf(e)));
  const devices = pinned.filter((e) => !e.attributes.snapshot_of && !scenes.includes(e));

  return (
    <Screen
      title={greeting()}
      subtitle={on ? `${on} ${on === 1 ? 'device' : 'devices'} on` : 'Everything is off'}
      action={<Chip icon="star" label="Edit" onPress={() => setEditing(true)} />}>
      {favourites && pinned.length === 0 && (
        <Card>
          <ThemedText type="smallBold">Pin what you use most</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Star cameras, devices and scenes to see them here. Everything else stays on the Devices and Cameras tabs.
          </ThemedText>
          <View style={styles.row}>
            <Chip icon="star.fill" label="Choose favourites" onPress={() => setEditing(true)} />
            <Chip icon="lightbulb.fill" label="All devices" onPress={() => router.navigate('/devices')} />
          </View>
        </Card>
      )}

      {cameras.length > 0 && <CameraStrip ids={cameras} />}

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

      {devices.length > 0 && (
        <View style={styles.grid}>
          {devices.map((e) => (
            <Tile key={e.entity_id} entity={e} width={tileWidth(width)} onSettings={() => setDetail(e.entity_id)} />
          ))}
        </View>
      )}

      {editing && <FavouritesSheet onClose={() => setEditing(false)} />}
      {detail && entities[detail] && <DeviceSheet entity={entities[detail]} onClose={() => setDetail(undefined)} />}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  chips: { gap: Spacing.two },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: GAP },
});
