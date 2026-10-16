import type { HassEntity } from 'home-assistant-js-websocket';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { allDevices } from '@/components/device-tile';
import { Card } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { FavouriteStar, useFavourites } from '@/favourites';
import { byDomain, name, useHA } from '@/ha';

/** Pick what the Home tab shows. */
export function FavouritesSheet({ onClose }: { onClose: () => void }) {
  const { entities, devices } = useHA();
  const sections: [string, HassEntity[]][] = [
    ['Cameras', byDomain(entities, 'camera').filter((e) => e.attributes.snapshot_of)],
    ['Devices', allDevices(entities, devices)],
    ['Scenes', byDomain(entities, 'scene', 'script')],
  ];

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <ThemedView style={styles.flex}>
        <ScrollView contentContainerStyle={styles.sheet}>
          <View style={styles.header}>
            <ThemedText type="subtitle" style={styles.flex}>
              Favourites
            </ThemedText>
            <Pressable onPress={onClose} accessibilityRole="button" hitSlop={12}>
              <ThemedText type="linkPrimary">Done</ThemedText>
            </Pressable>
          </View>
          <ThemedText type="small" themeColor="textSecondary">
            Starred items show on Home, in the order you star them.
          </ThemedText>
          {sections.map(
            ([title, list]) =>
              list.length > 0 && (
                <View key={title} style={styles.section}>
                  <ThemedText type="smallBold" themeColor="textSecondary">
                    {title}
                  </ThemedText>
                  <Card>
                    {list.map((e) => (
                      <StarRow key={e.entity_id} entity={e} />
                    ))}
                  </Card>
                </View>
              ),
          )}
        </ScrollView>
      </ThemedView>
    </Modal>
  );
}

function StarRow({ entity }: { entity: HassEntity }) {
  const { isFavourite, toggle } = useFavourites();
  const on = isFavourite(entity.entity_id);
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={name(entity)}
      accessibilityState={{ checked: on }}
      onPress={() => toggle(entity.entity_id)}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
      <ThemedText style={styles.flex} numberOfLines={1}>
        {name(entity)}
      </ThemedText>
      <FavouriteStar on={on} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  sheet: { padding: Spacing.three, gap: Spacing.three, paddingBottom: Spacing.six },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.two },
  section: { gap: Spacing.two },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.two },
  pressed: { opacity: 0.6 },
});
