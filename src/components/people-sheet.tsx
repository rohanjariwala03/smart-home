import * as ImagePicker from 'expo-image-picker';
import { useState } from 'react';
import { ActivityIndicator, Alert, Image, Modal, Pressable, ScrollView, StyleSheet, Switch, TextInput, View } from 'react-native';

import { removeAutomation, setWelcome, useAutomation, useAutomationConfig, welcomeOf, WELCOME_ID, type Welcome } from '@/automations';
import { Chip } from '@/components/chip';
import { SWATCHES } from '@/components/device-sheet';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { isEcho, name as nameOf, players, switchables, useHA } from '@/ha';
import { useTheme } from '@/hooks/use-theme';
import { addPhotos, auth, faceUrl, removePerson, usePeople } from '@/vision';

const NAME = /^[\p{L}\p{N}][\p{L}\p{N}_ .'-]{0,39}$/u; // what Blink Vision accepts as a name

const pick = () =>
  ImagePicker.launchImageLibraryAsync({
    mediaTypes: 'images',
    allowsMultipleSelection: true,
    selectionLimit: 10,
    quality: 0.8,
    // JPEG, not HEIC: Blink Vision reads JPEG and PNG.
    preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
  });

/** The people the cameras recognize (Blink Vision), and teaching it new ones from photos on this phone. */
export function PeopleSheet({ onClose }: { onClose: () => void }) {
  const { creds } = useHA();
  const theme = useTheme();
  const { people, error, refresh } = usePeople();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState<string>();
  const [problems, setProblems] = useState<string[]>([]);

  const teach = async (who: string) => {
    if (!creds) return;
    const picked = await pick();
    if (picked.canceled) return;
    setBusy(who);
    setProblems([]);
    try {
      setProblems(await addPhotos(creds, who, picked.assets.map((a) => a.uri)));
      setName('');
    } catch (e: any) {
      setProblems([e?.message ?? String(e)]);
    } finally {
      setBusy(undefined);
      refresh();
    }
  };

  const forget = (who: string) =>
    Alert.alert(`Forget ${who}?`, 'Their visits will alert you again.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Forget',
        style: 'destructive',
        onPress: () => creds && removePerson(creds, who).then(refresh, (e) => setProblems([e.message])),
      },
    ]);

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <ThemedView style={styles.flex}>
        <View style={styles.header}>
          <ThemedText type="subtitle">People</ThemedText>
          <View style={styles.flex} />
          <Pressable onPress={onClose} accessibilityRole="button" hitSlop={12}>
            <ThemedText type="linkPrimary">Done</ThemedText>
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          {people === undefined && !error ? (
            <ActivityIndicator />
          ) : people === null ? (
            <ThemedText themeColor="textSecondary">
              Face recognition runs in the Blink Vision add-on. In Home Assistant open Settings › Add-ons › Add-on store ›
              ⋮ › Repositories and add github.com/rohanjariwala03/ha-blink-instant-events, then install Blink Vision and
              start it.
            </ThemedText>
          ) : (
            <>
              <ThemedText themeColor="textSecondary">
                The cameras recognize these people, so their visits don’t have to alert you. Add 3–5 clear photos of each
                face from different angles. Photos stay on your Home Assistant.
              </ThemedText>
              {people?.map((p) => (
                <View key={p.name} style={[styles.person, { backgroundColor: theme.backgroundElement }]}>
                  {creds && <Image source={{ uri: faceUrl(creds, p.name), headers: auth(creds) }} style={styles.face} />}
                  <View style={styles.flex}>
                    <ThemedText style={styles.bold}>{p.name}</ThemedText>
                    <ThemedText type="small" themeColor="textSecondary">
                      {p.photos} photo{p.photos === 1 ? '' : 's'}
                    </ThemedText>
                  </View>
                  {busy === p.name ? (
                    <ActivityIndicator />
                  ) : (
                    <>
                      <Chip icon="plus" label="Photos" disabled={!!busy} onPress={() => teach(p.name)} />
                      <Chip icon="trash" label="Forget" disabled={!!busy} onPress={() => forget(p.name)} />
                    </>
                  )}
                </View>
              ))}
              <View style={[styles.person, { backgroundColor: theme.backgroundElement }]}>
                <TextInput
                  value={name}
                  onChangeText={setName}
                  placeholder="Add someone: their name"
                  placeholderTextColor={theme.textSecondary}
                  autoCapitalize="words"
                  autoCorrect={false}
                  style={[styles.flex, styles.input, { color: theme.text }]}
                />
                {busy && busy === name.trim() ? (
                  <ActivityIndicator />
                ) : (
                  <Chip
                    icon="photo.on.rectangle"
                    label="Choose photos"
                    disabled={!!busy || !NAME.test(name.trim())}
                    onPress={() => teach(name.trim())}
                  />
                )}
              </View>
              {!!people?.length && <WelcomeCard names={people.map((p) => p.name)} />}
            </>
          )}
          {[error, ...problems].filter(Boolean).map((p) => (
            <ThemedText key={p} type="small" style={styles.error}>
              {p}
            </ThemedText>
          ))}
        </ScrollView>
      </ThemedView>
    </Modal>
  );
}

/** Someone Blink Vision knows at the door: lights in their colour, and their greeting on the Echoes. */
function WelcomeCard({ names }: { names: string[] }) {
  const { creds, entities, devices } = useHA();
  const theme = useTheme();
  const auto = useAutomation(WELCOME_ID);
  const saved = welcomeOf(useAutomationConfig(WELCOME_ID));
  const [draft, setDraft] = useState<Welcome>();
  const [note, setNote] = useState<string>();
  if (!creds) return null;

  const echoes = players(entities, devices).filter(isEcho);
  const w: Welcome = draft ?? saved ?? { people: {}, lights: [], echoes: echoes.map((e) => e.entity_id), darkOnly: true };
  const save = (next: Welcome) => {
    setDraft(next);
    setNote(undefined);
    (Object.keys(next.people).length ? setWelcome(creds, next, entities) : auto && removeAutomation(creds, WELCOME_ID))?.catch(
      (e) => setNote(e?.message ?? String(e)),
    );
  };
  const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  const person = (who: string, on: boolean) => {
    const { [who]: _, ...rest } = w.people;
    save({ ...w, people: on ? { ...w.people, [who]: { rgb: SWATCHES[names.indexOf(who) % SWATCHES.length], say: `Welcome home, ${who}.` } } : rest });
  };

  return (
    <View style={[styles.welcome, { backgroundColor: theme.backgroundElement }]}>
      <ThemedText style={styles.bold}>Welcome home</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        When the doorbell camera recognises someone, the lights below turn their colour and the Echoes greet them. Once
        every 10 minutes at most.
      </ThemedText>
      {names.map((who) => {
        const p = w.people[who];
        return (
          <View key={who} style={styles.greet}>
            <View style={styles.row}>
              <ThemedText style={styles.flex}>{who}</ThemedText>
              <Switch value={!!p} onValueChange={(on) => person(who, on)} />
            </View>
            {p && (
              <>
                <View style={styles.row}>
                  {SWATCHES.map((rgb) => (
                    <Pressable
                      key={rgb.join()}
                      accessibilityLabel={`${who}'s colour: rgb ${rgb.join(' ')}`}
                      accessibilityState={{ selected: rgb.join() === p.rgb.join() }}
                      onPress={() => save({ ...w, people: { ...w.people, [who]: { ...p, rgb } } })}
                      style={[styles.swatch, { backgroundColor: `rgb(${rgb.join()})` }, rgb.join() === p.rgb.join() && { borderColor: theme.text, borderWidth: 3 }]}
                    />
                  ))}
                </View>
                <TextInput
                  defaultValue={p.say}
                  onEndEditing={(e) => {
                    const say = e.nativeEvent.text.trim();
                    if (say && say !== p.say) save({ ...w, people: { ...w.people, [who]: { ...p, say } } });
                  }}
                  placeholder="What the Echo says"
                  placeholderTextColor={theme.textSecondary}
                  style={[styles.input, styles.field, { color: theme.text, borderColor: theme.textSecondary }]}
                />
              </>
            )}
          </View>
        );
      })}
      {Object.keys(w.people).length > 0 && (
        <>
          <ThemedText type="small" themeColor="textSecondary">Lights</ThemedText>
          <View style={styles.wrap}>
            {switchables(entities, devices).map((e) => (
              <Chip key={e.entity_id} label={nameOf(e)} selected={w.lights.includes(e.entity_id)} onPress={() => save({ ...w, lights: toggle(w.lights, e.entity_id) })} />
            ))}
          </View>
          <View style={styles.row}>
            <ThemedText style={styles.flex}>Lights only after dark</ThemedText>
            <Switch value={w.darkOnly} onValueChange={(darkOnly) => save({ ...w, darkOnly })} />
          </View>
          {echoes.length > 0 && (
            <>
              <ThemedText type="small" themeColor="textSecondary">Greet on</ThemedText>
              <View style={styles.wrap}>
                {echoes.map((e) => (
                  <Chip key={e.entity_id} icon="homepod.fill" label={nameOf(e)} selected={w.echoes.includes(e.entity_id)} onPress={() => save({ ...w, echoes: toggle(w.echoes, e.entity_id) })} />
                ))}
              </View>
            </>
          )}
        </>
      )}
      {note && <ThemedText type="small" style={styles.error}>{note}</ThemedText>}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', padding: Spacing.three },
  body: { paddingHorizontal: Spacing.three, paddingBottom: Spacing.six, gap: Spacing.two },
  person: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, padding: Spacing.two, borderRadius: 14 },
  face: { width: 48, height: 48, borderRadius: 24, backgroundColor: '#0003' },
  bold: { fontWeight: '600' },
  input: { fontSize: 16, paddingVertical: 8 },
  error: { color: '#E5484D' },
  welcome: { padding: Spacing.three, borderRadius: 14, gap: Spacing.two, marginTop: Spacing.two },
  greet: { gap: Spacing.two },
  row: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: Spacing.two },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  swatch: { width: 32, height: 32, borderRadius: 16, borderWidth: 1, borderColor: '#8888' },
  field: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 10, paddingHorizontal: 10 },
});
