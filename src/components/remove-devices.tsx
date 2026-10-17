import { SymbolView } from 'expo-symbols';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';

import { Disclosure } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { deviceName, useHA, type Device } from '@/ha';
import { ADMIN_ONLY } from '@/setup';

type Registered = Device & { config_entries: string[]; entry_type: string | null; disabled_by: string | null };

const message = (e: any) => (e?.code === 'unauthorized' ? ADMIN_ONLY : (e?.message ?? String(e)));

/**
 * Remove a device from Home Assistant after asking. Integrations that can't delete one get it disabled instead:
 * hidden everywhere, and not added back. `done` runs after either.
 */
export function useRemoveDevice() {
  const { conn, reloadRegistry } = useHA();
  const remove = async (id: string, title: string) => {
    if (!conn) return;
    const all = await conn.sendMessagePromise<Registered[]>({ type: 'config/device_registry/list' });
    try {
      for (const entry of all.find((d) => d.id === id)?.config_entries ?? [])
        await conn.sendMessagePromise({ type: 'config/device_registry/remove_config_entry', device_id: id, config_entry_id: entry });
    } catch (e: any) {
      if (e?.code === 'unauthorized') throw e;
      await conn.sendMessagePromise({ type: 'config/device_registry/update', device_id: id, disabled_by: 'user' });
      Alert.alert(
        'Disabled instead',
        `${title}'s integration doesn't let Home Assistant delete it, so it's disabled: hidden everywhere and not added back. To undo, enable it in Home Assistant › Settings › Devices.`,
      );
    }
    reloadRegistry();
  };
  return (id: string, title: string, done?: () => void) =>
    Alert.alert(`Remove ${title}?`, 'It disappears from this app and Home Assistant, with its history.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => remove(id, title).then(done, (e) => Alert.alert('Couldn’t remove', message(e))),
      },
    ]);
}

/**
 * Every device in Home Assistant, to remove one you don't own (a neighbour's TV found on the network). Integrations
 * that can't delete a device get it disabled instead: hidden everywhere, and not added back.
 */
export function YourDevices() {
  const { conn } = useHA();
  const [list, setList] = useState<Registered[]>();
  const load = useCallback(
    () => conn?.sendMessagePromise<Registered[]>({ type: 'config/device_registry/list' }).then(setList, () => setList([])),
    [conn],
  );
  useEffect(() => {
    load();
  }, [load]);

  const confirm = useRemoveDevice();

  // Services (Sun, add-ons, integrations' own entries) aren't things in your home.
  const shown = (list ?? [])
    .filter((d) => d.entry_type !== 'service' && !d.disabled_by)
    .map((d) => ({ d, title: deviceName(d) ?? 'Unnamed device' }))
    .sort((x, y) => x.title.localeCompare(y.title));

  return (
    <Disclosure title="Remove a device" summary={list ? `${shown.length} devices` : undefined}>
      {shown.map(({ d, title }) => (
        <View key={d.id} style={styles.row}>
          <View style={styles.flex}>
            <ThemedText numberOfLines={1}>{title}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
              {[d.manufacturer, d.model].filter(Boolean).join(' · ') || 'Unknown maker'}
            </ThemedText>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${title}`} hitSlop={10} onPress={() => confirm(d.id, title, load)}>
            <SymbolView name="trash" size={18} tintColor="#FF453A" />
          </Pressable>
        </View>
      ))}
    </Disclosure>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.one },
  flex: { flex: 1 },
});
