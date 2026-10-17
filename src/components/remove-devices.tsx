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
 * Every device in Home Assistant, to remove one you don't own (a neighbour's TV found on the network). Integrations
 * that can't delete a device get it disabled instead: hidden everywhere, and not added back.
 */
export function YourDevices() {
  const { conn, reloadRegistry } = useHA();
  const [list, setList] = useState<Registered[]>();
  const load = useCallback(
    () => conn?.sendMessagePromise<Registered[]>({ type: 'config/device_registry/list' }).then(setList, () => setList([])),
    [conn],
  );
  useEffect(() => {
    load();
  }, [load]);

  const remove = async (d: Registered, title: string) => {
    if (!conn) return;
    try {
      for (const entry of d.config_entries)
        await conn.sendMessagePromise({ type: 'config/device_registry/remove_config_entry', device_id: d.id, config_entry_id: entry });
    } catch (e: any) {
      if (e?.code === 'unauthorized') throw e;
      await conn.sendMessagePromise({ type: 'config/device_registry/update', device_id: d.id, disabled_by: 'user' });
      Alert.alert(
        'Disabled instead',
        `${title}'s integration doesn't let Home Assistant delete it, so it's disabled: hidden everywhere and not added back. To undo, enable it in Home Assistant › Settings › Devices.`,
      );
    }
    reloadRegistry();
    load();
  };

  const confirm = (d: Registered, title: string) =>
    Alert.alert(`Remove ${title}?`, 'It disappears from this app and Home Assistant, with its history.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => remove(d, title).catch((e) => Alert.alert('Couldn’t remove', message(e))) },
    ]);

  // Services (Sun, add-ons, integrations' own entries) aren't things in your home.
  const shown = (list ?? [])
    .filter((d) => d.entry_type !== 'service' && !d.disabled_by)
    .map((d) => ({ d, title: deviceName(d) ?? 'Unnamed device' }))
    .sort((x, y) => x.title.localeCompare(y.title));

  return (
    <Disclosure title="Your devices" summary={list ? String(shown.length) : undefined}>
      {shown.map(({ d, title }) => (
        <View key={d.id} style={styles.row}>
          <View style={styles.flex}>
            <ThemedText numberOfLines={1}>{title}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
              {[d.manufacturer, d.model].filter(Boolean).join(' · ') || 'Unknown maker'}
            </ThemedText>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${title}`} hitSlop={10} onPress={() => confirm(d, title)}>
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
