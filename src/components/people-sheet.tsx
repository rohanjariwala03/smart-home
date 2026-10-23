import * as ImagePicker from 'expo-image-picker';
import { useState } from 'react';
import { ActivityIndicator, Alert, Image, Modal, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { Chip } from '@/components/chip';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useHA } from '@/ha';
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

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', padding: Spacing.three },
  body: { paddingHorizontal: Spacing.three, paddingBottom: Spacing.six, gap: Spacing.two },
  person: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, padding: Spacing.two, borderRadius: 14 },
  face: { width: 48, height: 48, borderRadius: 24, backgroundColor: '#0003' },
  bold: { fontWeight: '600' },
  input: { fontSize: 16, paddingVertical: 8 },
  error: { color: '#E5484D' },
});
