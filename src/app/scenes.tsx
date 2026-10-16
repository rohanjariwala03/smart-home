import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';

import { Chip } from '@/components/chip';
import { SceneEditor } from '@/components/scene-editor';
import { Card, Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { byDomain, name, useHA } from '@/ha';
import { isAppScene, runScene } from '@/scenes';

// Scenes made here (HA scripts, see src/scenes.ts) plus any scene or script made in Home Assistant.
export default function ScenesScreen() {
  const { conn, creds, entities } = useHA();
  const [editing, setEditing] = useState<string | true>(); // script entity, or true for a new scene
  const [running, setRunning] = useState<string>();

  const run = (id: string) => {
    if (!conn) return;
    setRunning(id);
    runScene(conn, id)
      .catch((e) => Alert.alert('Scene failed', e?.message ?? String(e)))
      .finally(() => setRunning(undefined));
  };

  return (
    <Screen title="Scenes" action={creds && <Chip icon="plus" label="New scene" onPress={() => setEditing(true)} />}>
      {byDomain(entities, 'scene', 'script').map((e) => (
        <Pressable key={e.entity_id} accessibilityRole="button" accessibilityLabel={`Run ${name(e)}`} onPress={() => run(e.entity_id)}>
          {({ pressed }) => (
            <Card dim={pressed || running === e.entity_id}>
              <View style={styles.row}>
                <SymbolView name={e.entity_id.startsWith('scene.') || isAppScene(e.entity_id) ? 'sparkles' : 'play.fill'} size={18} tintColor="#8E8E93" />
                <ThemedText style={styles.flex}>{name(e)}</ThemedText>
                {isAppScene(e.entity_id) && (
                  <Pressable accessibilityRole="button" accessibilityLabel={`Edit ${name(e)}`} hitSlop={12} onPress={() => setEditing(e.entity_id)}>
                    <SymbolView name="pencil" size={18} tintColor="#8E8E93" />
                  </Pressable>
                )}
              </View>
            </Card>
          )}
        </Pressable>
      ))}
      <ThemedText type="small" themeColor="textSecondary">
        Scenes made here are saved in Home Assistant, so Siri, widgets and the watch can run them too. Govee scenes in them only
        apply when run from this app.
      </ThemedText>
      {editing && <SceneEditor entityId={editing === true ? undefined : editing} onClose={() => setEditing(undefined)} />}
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
});
