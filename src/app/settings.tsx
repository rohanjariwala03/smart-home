import { useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

import { AddDeviceSheet, DiscoveredList, type SheetStart } from '@/components/add-device';
import { AnnounceSettings } from '@/components/announce-settings';
import { Chip } from '@/components/chip';
import { YourDevices } from '@/components/remove-devices';
import { Card, Disclosure, Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { listGovee, useGoveeKey } from '@/govee';
import { useHA } from '@/ha';
import { useTheme } from '@/hooks/use-theme';

export default function SettingsScreen() {
  const { creds, conn, status, error, entities, save } = useHA();
  const theme = useTheme();
  const [draftUrl, setUrl] = useState<string>();
  const url = draftUrl ?? creds?.url ?? '';
  const [token, setToken] = useState('');
  const [sheet, setSheet] = useState<SheetStart>();
  const input = [styles.input, { color: theme.text, borderColor: theme.textSecondary }];

  const trimmedUrl = url.trim().replace(/\/+$/, '');
  const nextToken = token.trim() || creds?.token || '';
  const valid = /^https?:\/\/.+/.test(trimmedUrl) && nextToken.length > 0;
  const ready = status === 'ready';

  return (
    <Screen title="Settings">
      <Card>
        <ThemedText type="smallBold">Devices</ThemedText>
        <DiscoveredList onSetUp={(flowId) => setSheet({ flowId })} />
        <View style={styles.chips}>
          <Chip icon="plus" label="Add by brand" disabled={!ready} onPress={() => setSheet('brand')} />
          <Chip icon="qrcode" label="Matter pairing code" disabled={!ready} onPress={() => setSheet('matter')} />
        </View>
        <YourDevices />
      </Card>
      {sheet && <AddDeviceSheet start={sheet} onClose={() => setSheet(undefined)} />}

      <AnnounceSettings />

      <Card>
        <ThemedText type="smallBold">Home Assistant</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {ready ? `Connected · ${conn?.haVersion ?? ''} · ${Object.keys(entities).length} entities` : `${status}${error ? ` (${error})` : ''}`}
        </ThemedText>
        <Disclosure title="Address & token" summary={creds?.url} initiallyOpen={!creds}>
          <TextInput
            style={input}
            value={url}
            onChangeText={setUrl}
            placeholder="http://192.168.x.x"
            placeholderTextColor={theme.textSecondary}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
          />
          <TextInput
            style={input}
            value={token}
            onChangeText={setToken}
            placeholder={creds ? 'Long-lived token (saved; leave blank to keep)' : 'Long-lived access token'}
            placeholderTextColor={theme.textSecondary}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
          />
          <View style={styles.chips}>
            <Chip
              icon="link"
              label="Save & connect"
              selected
              disabled={!valid}
              onPress={() => {
                save({ url: trimmedUrl, token: nextToken });
                setToken('');
              }}
            />
          </View>
          <ThemedText type="small" themeColor="textSecondary">
            Token is stored in the iOS Keychain. Adding devices needs an admin user&apos;s token; for control only, a
            non-admin user (Profile → Security) is safer.
          </ThemedText>
        </Disclosure>
        <GoveeSettings />
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  input: { borderWidth: 1, borderRadius: 10, padding: Spacing.two, fontSize: 16 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
});

// Optional Govee cloud key: adds scenes, music mode and DreamView to Matter-added Govee lights' settings.
function GoveeSettings() {
  const { key, save } = useGoveeKey();
  const theme = useTheme();
  const [draft, setDraft] = useState('');
  const [note, setNote] = useState<string>();

  const check = async () => {
    const next = draft.trim();
    setNote('Checking…');
    try {
      const n = (await listGovee(next)).length;
      await save(next);
      setDraft('');
      setNote(`Saved. ${n} Govee device${n === 1 ? '' : 's'} found.`);
    } catch (e: any) {
      setNote(`Not saved: ${e?.message ?? e}`);
    }
  };

  return (
    <Disclosure title="Govee cloud key" summary={key ? 'Saved' : 'Not set'}>
      <ThemedText type="small" themeColor="textSecondary">
        Only for Govee lights added over Matter: adds scenes, music mode and DreamView to the light&apos;s settings. Lights
        from the Govee integration in Home Assistant already have them. Get a key in the Govee Home app: Profile →
        Settings → Apply for API Key.
      </ThemedText>
      <TextInput
        style={[styles.input, { color: theme.text, borderColor: theme.textSecondary }]}
        value={draft}
        onChangeText={setDraft}
        placeholder={key ? 'API key saved (enter a new one to replace)' : 'Govee API key'}
        placeholderTextColor={theme.textSecondary}
        autoCapitalize="none"
        autoCorrect={false}
        secureTextEntry
      />
      <View style={styles.chips}>
        <Chip icon="key.fill" label="Save key" disabled={!draft.trim()} onPress={check} />
        {key && (
          <Chip
            icon="trash"
            label="Remove key"
            onPress={() => {
              save(null);
              setNote(undefined);
            }}
          />
        )}
      </View>
      {note && <ThemedText type="small">{note}</ThemedText>}
    </Disclosure>
  );
}
