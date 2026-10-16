import { SymbolView } from 'expo-symbols';
import type { HassEntity } from 'home-assistant-js-websocket';
import { useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { LiveGrid } from '@/components/live-grid';
import { LiveView } from '@/components/live-view';
import { Spacing } from '@/constants/theme';
import { byDomain, name, useHA } from '@/ha';

// Dashboard row of camera snapshots. Tap one for live view; "All live" opens the grid.
export function CameraStrip() {
  const { creds, entities } = useHA();
  const [watch, setWatch] = useState<HassEntity>();
  const [grid, setGrid] = useState(false);
  const cameras = byDomain(entities, 'camera').filter((e) => e.attributes.snapshot_of);
  if (!creds || !cameras.length) return null;

  const live = (slug: string) =>
    Object.values(entities).find((e) => e.entity_id.startsWith('camera.') && e.attributes.proxy_slug === slug);

  return (
    <>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        {cameras.map((e) => {
          const motion = entities[`binary_sensor.${e.entity_id.split('.')[1]}_motion`]?.state === 'on';
          return (
            <Pressable
              key={e.entity_id}
              accessibilityRole="button"
              accessibilityLabel={`${name(e)} live view`}
              onPress={() => setWatch(e)}
              style={({ pressed }) => [styles.card, pressed && styles.pressed]}>
              {e.attributes.entity_picture && (
                <Image source={{ uri: `${creds.url}${e.attributes.entity_picture}` }} style={StyleSheet.absoluteFill} />
              )}
              <View style={styles.shade} />
              <View style={styles.label}>
                {motion && <View style={styles.dot} />}
                <Text style={styles.name} numberOfLines={1}>
                  {name(e)}
                </Text>
                <SymbolView name="play.circle.fill" size={18} tintColor="#fff" />
              </View>
            </Pressable>
          );
        })}
        {cameras.length > 1 && (
          <Pressable
            accessibilityRole="button"
            onPress={() => setGrid(true)}
            style={({ pressed }) => [styles.card, styles.all, pressed && styles.pressed]}>
            <SymbolView name="square.grid.2x2.fill" size={26} tintColor="#fff" />
            <Text style={styles.name}>All live</Text>
          </Pressable>
        )}
      </ScrollView>

      {watch && (
        <LiveView
          creds={creds}
          slug={watch.attributes.snapshot_of}
          title={name(watch)}
          ptt={live(watch.attributes.snapshot_of)?.attributes.ptt_supported !== false}
          onClose={() => setWatch(undefined)}
        />
      )}
      {grid && (
        <LiveGrid
          creds={creds}
          cameras={cameras.map((e) => ({ slug: e.attributes.snapshot_of, name: name(e) }))}
          onClose={() => setGrid(false)}
        />
      )}
    </>
  );
}

const styles = StyleSheet.create({
  row: { gap: Spacing.two },
  card: { width: 200, height: 112, borderRadius: 16, overflow: 'hidden', backgroundColor: '#1c1c1e' },
  all: { width: 112, alignItems: 'center', justifyContent: 'center', gap: Spacing.two },
  shade: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.25)' },
  label: {
    position: 'absolute',
    left: Spacing.two,
    right: Spacing.two,
    bottom: Spacing.two,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#FF3B30' },
  name: { flex: 1, color: '#fff', fontWeight: '700', fontSize: 14 },
  pressed: { opacity: 0.7 },
});
