import { Button, Host, Label, List, Section, Text } from '@expo/ui/swift-ui';
import { environment } from '@expo/ui/swift-ui/modifiers';
import type { HassEntity } from 'home-assistant-js-websocket';
import { Modal, Pressable, StyleSheet, View } from 'react-native';

import { allDevices, domainOf, ICONS } from '@/components/device-tile';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useFavourites } from '@/favourites';
import { byDomain, name, scenesOf, useHA } from '@/ha';

const icon = (e: HassEntity) => (e.attributes.snapshot_of ? 'video.fill' : (ICONS[domainOf(e)] ?? 'power'));

/** Pick what the Home tab shows and in what order: drag to reorder, swipe or ⊖ to remove, ⊕ to add. */
export function FavouritesSheet({ onClose }: { onClose: () => void }) {
  const { entities, devices } = useHA();
  const { favourites = [], toggle, save } = useFavourites();
  const pinned = favourites.filter((id) => entities[id]);
  const sections: [string, HassEntity[]][] = [
    ['Cameras', byDomain(entities, 'camera').filter((e) => e.attributes.snapshot_of)],
    ['Devices', allDevices(entities, devices)],
    ['Scenes', scenesOf(entities)],
  ];

  // SwiftUI's onMove: `destination` is an index into the list before the move.
  const move = (from: number[], destination: number) => {
    const moved = from.map((i) => pinned[i]);
    const rest = pinned.filter((_, i) => !from.includes(i));
    rest.splice(destination - from.filter((i) => i < destination).length, 0, ...moved);
    save([...rest, ...favourites.filter((id) => !entities[id])]);
  };
  const remove = (indices: number[]) => save(favourites.filter((id) => !indices.some((i) => pinned[i] === id)));

  return (
    <Modal supportedOrientations={['portrait', 'landscape']} visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <ThemedView style={styles.flex}>
        <View style={styles.header}>
          <ThemedText type="subtitle" style={styles.flex}>
            Favourites
          </ThemedText>
          <Pressable onPress={onClose} accessibilityRole="button" hitSlop={12}>
            <ThemedText type="linkPrimary">Done</ThemedText>
          </Pressable>
        </View>
        <Host style={styles.flex}>
          <List modifiers={[environment('editMode', 'active')]}>
            <Section title="On Home" footer={<Text>Drag to reorder. Tap ⊖ or swipe to remove.</Text>}>
              {pinned.length === 0 && <Text>Nothing yet. Add some below.</Text>}
              <List.ForEach onMove={move} onDelete={remove}>
                {pinned.map((id) => (
                  <Label key={id} title={name(entities[id])} systemImage={icon(entities[id])} />
                ))}
              </List.ForEach>
            </Section>
            {sections.map(([title, list]) => {
              const rest = list.filter((e) => !favourites.includes(e.entity_id));
              return (
                rest.length > 0 && (
                  <Section key={title} title={`Add ${title.toLowerCase()}`}>
                    {rest.map((e) => (
                      <Button key={e.entity_id} systemImage="plus.circle.fill" label={name(e)} onPress={() => toggle(e.entity_id)} />
                    ))}
                  </Section>
                )
              );
            })}
          </List>
        </Host>
      </ThemedView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, padding: Spacing.three },
});
