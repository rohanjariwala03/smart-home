import { useEffect, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { fetchClips, time, type Clip } from '@/components/clips';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useHA } from '@/ha';
import { auth } from '@/vision';

/**
 * "Today": what the cameras saw in the last 24 hours, as Blink Vision labeled it, newest first. Tapping one plays
 * its clip. Hidden until there is something labeled (no Blink Vision, or a quiet day).
 */
export function TodayStrip({ onOpen }: { onOpen: (clip: Clip) => void }) {
  const { creds, entities } = useHA();
  const [clips, setClips] = useState<Clip[]>([]);
  // Re-read whenever a camera's "Last detection" picture changes.
  const latest = Object.values(entities)
    .filter((e) => e.entity_id.startsWith('image.') && e.entity_id.endsWith('_last_detection'))
    .map((e) => e.state)
    .sort()
    .join();

  useEffect(() => {
    if (!creds || !latest) return;
    let cancelled = false;
    fetchClips(creds, 'both', 24, 50, 3).then(
      (body) => !cancelled && setClips(body.clips.filter((c) => c.detection)),
      () => {},
    );
    return () => {
      cancelled = true;
    };
  }, [creds, latest]);

  if (!creds || !clips.length) return null;
  return (
    <View style={styles.wrap}>
      <ThemedText type="smallBold" themeColor="textSecondary">Today</ThemedText>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.strip}>
        {clips.map((c) => (
          <Pressable
            key={c.id}
            accessibilityRole="button"
            accessibilityLabel={`${c.detection!.summary} at ${c.camera_name}, ${time(c)}`}
            onPress={() => onOpen(c)}
            style={({ pressed }) => [styles.item, pressed && styles.pressed]}>
            <Image source={{ uri: creds.url + c.detection!.image_url, headers: auth(creds) }} style={styles.image} />
            <Text style={styles.stamp}>{time(c)}</Text>
            <ThemedText type="small" numberOfLines={1} style={styles.bold}>
              {c.detection!.summary}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
              {c.camera_name}
            </ThemedText>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: Spacing.two },
  strip: { gap: Spacing.two },
  item: { width: 168 },
  image: { width: 168, height: 95, borderRadius: 10, backgroundColor: '#0003', marginBottom: 4 },
  stamp: {
    position: 'absolute',
    left: 6,
    top: 6,
    color: '#fff',
    fontSize: 11,
    fontWeight: '600',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 999,
    overflow: 'hidden',
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  bold: { fontWeight: '600' },
  pressed: { opacity: 0.7 },
});
