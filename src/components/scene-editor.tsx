import type { HassEntity } from 'home-assistant-js-websocket';
import { useEffect, useState } from 'react';
import { Alert, Button, Modal, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { Chip } from '@/components/chip';
import { SWATCHES } from '@/components/device-sheet';
import { Card } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { isEcho, name, players, switchables, useHA } from '@/ha';
import { goveeOptions, useGoveeKey, type GoveeStep } from '@/govee';
import { useTheme } from '@/hooks/use-theme';
import { deleteScene, newSceneId, readScene, saveScene, type AppScene, type SceneStep } from '@/scenes';

const BRIGHTNESS = [10, 25, 50, 75, 100];
const COLOR_MODES = ['hs', 'rgb', 'rgbw', 'rgbww', 'xy'];

/** Create or edit one of the app's scenes. `entityId` = the scene's script, when editing. */
export function SceneEditor({ entityId, onClose }: { entityId?: string; onClose: () => void }) {
  const { conn, creds, entities, devices } = useHA();
  const theme = useTheme();
  const [scene, setScene] = useState<AppScene>({ name: '', steps: [], govee: [] });
  const [busy, setBusy] = useState(false);
  const all = [...switchables(entities, devices), ...players(entities, devices).filter((e) => !isEcho(e))];

  useEffect(() => {
    if (conn && entityId) readScene(conn, entityId).then(setScene, () => {});
  }, [conn, entityId]);

  const step = (entity: string) => scene.steps.find((s) => s.entity === entity);
  const setStep = (entity: string, next?: SceneStep) =>
    setScene((s) => ({
      ...s,
      steps: next ? [...s.steps.filter((x) => x.entity !== entity), next] : s.steps.filter((x) => x.entity !== entity),
      // A light that's off or left out can't show a Govee scene.
      govee: next?.on ? s.govee : s.govee.filter((g) => g.light !== entity),
    }));

  // Start from how things are right now.
  const capture = () =>
    setScene((s) => ({
      ...s,
      steps: all
        .filter((e) => e.state === 'on' || e.state === 'off')
        .map((e) => ({
          entity: e.entity_id,
          on: e.state === 'on',
          ...(e.state === 'on' && e.attributes.brightness && { brightness: Math.round(e.attributes.brightness / 2.55) }),
        })),
    }));

  const save = async () => {
    if (!creds) return;
    setBusy(true);
    const id = entityId ? entityId.split('.')[1] : newSceneId();
    try {
      await saveScene(creds, id, { ...scene, name: scene.name.trim() });
      onClose();
    } catch (e: any) {
      Alert.alert('Couldn’t save', e?.message ?? String(e));
    }
    setBusy(false);
  };

  const remove = () =>
    Alert.alert(`Delete ${scene.name}?`, undefined, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => creds && entityId && deleteScene(creds, entityId.split('.')[1]).then(onClose, (e) => Alert.alert('Couldn’t delete', e?.message)),
      },
    ]);

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <ThemedView style={styles.flex}>
        <ScrollView contentContainerStyle={styles.sheet} keyboardShouldPersistTaps="handled">
          <View style={styles.header}>
            <Pressable onPress={onClose} accessibilityRole="button" hitSlop={12}>
              <ThemedText type="linkPrimary">Cancel</ThemedText>
            </Pressable>
            <ThemedText type="smallBold" style={[styles.flex, styles.center]}>
              {entityId ? 'Edit scene' : 'New scene'}
            </ThemedText>
            <Pressable
              onPress={save}
              disabled={busy || !scene.name.trim() || !scene.steps.length}
              accessibilityRole="button"
              hitSlop={12}>
              <ThemedText type="linkPrimary" style={(busy || !scene.name.trim() || !scene.steps.length) && styles.dim}>
                Save
              </ThemedText>
            </Pressable>
          </View>

          <TextInput
            value={scene.name}
            onChangeText={(n) => setScene((s) => ({ ...s, name: n }))}
            placeholder="Name, e.g. Movie"
            placeholderTextColor={theme.textSecondary}
            style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
          />
          <Chip icon="camera.viewfinder" label="Start from what’s on now" onPress={capture} />

          {all.map((e) => (
            <StepCard key={e.entity_id} entity={e} step={step(e.entity_id)} onChange={(s) => setStep(e.entity_id, s)} scene={scene} setScene={setScene} />
          ))}

          {entityId && <Button title="Delete scene" color="#E5484D" onPress={remove} />}
        </ScrollView>
      </ThemedView>
    </Modal>
  );
}

function StepCard({ entity, step, onChange, scene, setScene }: {
  entity: HassEntity;
  step?: SceneStep;
  onChange: (s?: SceneStep) => void;
  scene: AppScene;
  setScene: (f: (s: AppScene) => AppScene) => void;
}) {
  const isLight = entity.entity_id.startsWith('light.');
  const color = isLight && (entity.attributes.supported_color_modes ?? []).some((m: string) => COLOR_MODES.includes(m));
  const dimmable = isLight && (entity.attributes.supported_color_modes ?? []).some((m: string) => m !== 'onoff');

  return (
    <Card dim={!step}>
      <ThemedText type="smallBold">{name(entity)}</ThemedText>
      <View style={styles.wrap}>
        <Chip label="Leave as is" selected={!step} onPress={() => onChange(undefined)} />
        <Chip label="On" selected={step?.on === true} onPress={() => onChange({ entity: entity.entity_id, on: true })} />
        <Chip label="Off" selected={step?.on === false} onPress={() => onChange({ entity: entity.entity_id, on: false })} />
      </View>
      {step?.on && dimmable && (
        <View style={styles.wrap}>
          {BRIGHTNESS.map((b) => (
            <Chip key={b} label={`${b}%`} selected={step.brightness === b} onPress={() => onChange({ ...step, brightness: step.brightness === b ? undefined : b })} />
          ))}
        </View>
      )}
      {step?.on && color && (
        <View style={styles.wrap}>
          {SWATCHES.map((rgb) => {
            const picked = step.rgb?.join() === rgb.join();
            return (
              <Pressable
                key={rgb.join()}
                accessibilityRole="button"
                accessibilityState={{ selected: picked }}
                accessibilityLabel={`Colour ${rgb.join(', ')}`}
                onPress={() => onChange({ ...step, rgb: picked ? undefined : rgb })}
                style={[styles.swatch, { backgroundColor: `rgb(${rgb.join()})` }, picked && styles.picked]}
              />
            );
          })}
        </View>
      )}
      {step?.on && isLight && <GoveePicker entity={entity} scene={scene} setScene={setScene} />}
    </Card>
  );
}

const SHOWN = 12;

// Govee scenes for a Govee light, when there's a Govee API key (Settings).
function GoveePicker({ entity, scene, setScene }: { entity: HassEntity; scene: AppScene; setScene: (f: (s: AppScene) => AppScene) => void }) {
  const { devices } = useHA();
  const { key } = useGoveeKey();
  const device = devices[entity.entity_id];
  const isGovee = !!device?.manufacturer?.toLowerCase().includes('govee');
  const [options, setOptions] = useState<GoveeStep[]>();
  const [all, setAll] = useState(false);

  useEffect(() => {
    if (key && device && isGovee) goveeOptions(key, device).then(setOptions, () => setOptions([]));
  }, [key, device, isGovee]);
  if (!isGovee || !key) return null;
  if (!options) return <ThemedText type="small" themeColor="textSecondary">Loading Govee scenes…</ThemedText>;

  const mine = scene.govee.filter((g) => g.light === entity.entity_id);
  const picked = (o: GoveeStep) => mine.some((g) => g.instance === o.instance && JSON.stringify(g.value) === JSON.stringify(o.value));
  // One scene at a time; toggles (DreamView) add on top.
  const pick = (o: GoveeStep) =>
    setScene((s) => ({
      ...s,
      govee: picked(o)
        ? s.govee.filter((g) => !(g.light === entity.entity_id && g.instance === o.instance && JSON.stringify(g.value) === JSON.stringify(o.value)))
        : [
            ...s.govee.filter((g) => !(g.light === entity.entity_id && (g.instance === o.instance || (isScene(g) && isScene(o))))),
            { ...o, light: entity.entity_id },
          ],
    }));
  const shown = all ? options : options.slice(0, SHOWN);

  return (
    <View style={styles.section}>
      <ThemedText type="small" themeColor="textSecondary">Govee</ThemedText>
      <View style={styles.wrap}>
        {shown.map((o, i) => (
          <Chip key={`${i}-${o.name}`} label={o.name} selected={picked(o)} onPress={() => pick(o)} />
        ))}
        {options.length > SHOWN && !all && <Chip label={`All ${options.length}…`} onPress={() => setAll(true)} />}
      </View>
    </View>
  );
}

const isScene = (g: GoveeStep) => g.type !== 'devices.capabilities.toggle';

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { textAlign: 'center' },
  dim: { opacity: 0.4 },
  sheet: { padding: Spacing.three, gap: Spacing.three, paddingBottom: Spacing.six },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.two },
  input: { fontSize: 17, padding: Spacing.three, borderRadius: 12 },
  section: { gap: Spacing.two },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  swatch: { width: 36, height: 36, borderRadius: 18, borderWidth: 1, borderColor: '#8888' },
  picked: { borderWidth: 3, borderColor: '#0A84FF' },
});
