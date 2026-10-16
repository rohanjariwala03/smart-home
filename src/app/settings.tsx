import { useState } from 'react';
import { Button, StyleSheet, TextInput } from 'react-native';

import { AddDeviceSheet, DiscoveredList, type SheetStart } from '@/components/add-device';
import { AnnounceSettings } from '@/components/announce-settings';
import { Card, Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { listGovee, useGoveeKey } from '@/govee';
import { byDomain, useHA } from '@/ha';
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

  const counts = (['light', 'switch', 'camera', 'scene', 'script'] as const)
    .map((d) => `${d} ${byDomain(entities, d).length}`)
    .join(' · ');

  return (
    <Screen title="Settings">
      <Card>
        <ThemedText type="smallBold">Home Assistant</ThemedText>
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
        <Button
          title="Save & connect"
          disabled={!valid}
          onPress={() => {
            save({ url: trimmedUrl, token: nextToken });
            setToken('');
          }}
        />
        <ThemedText type="small" themeColor="textSecondary">
          Token is stored in the iOS Keychain. Adding devices needs an admin user&apos;s token; for control only, a
          non-admin user (Profile → Security) is safer.
        </ThemedText>
      </Card>

      <Card>
        <ThemedText type="smallBold">Add devices</ThemedText>
        <DiscoveredList onSetUp={(flowId) => setSheet({ flowId })} />
        <Button title="Add by brand…" disabled={status !== 'ready'} onPress={() => setSheet('brand')} />
        <Button title="Matter pairing code…" disabled={status !== 'ready'} onPress={() => setSheet('matter')} />
      </Card>
      {sheet && <AddDeviceSheet start={sheet} onClose={() => setSheet(undefined)} />}

      <AnnounceSettings />

      <GoveeSettings />

      <Card>
        <ThemedText type="smallBold">Diagnostics</ThemedText>
        <ThemedText type="small">Status: {status}{error ? ` (${error})` : ''}</ThemedText>
        <ThemedText type="small">HA version: {conn?.haVersion ?? '–'}</ThemedText>
        <ThemedText type="small">Entities: {Object.keys(entities).length} ({counts})</ThemedText>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  input: { borderWidth: 1, borderRadius: 10, padding: Spacing.two, fontSize: 16 },
});

// Optional Govee cloud key: adds scenes, music mode and DreamView to Govee lights' detail screen.
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
    <Card>
      <ThemedText type="smallBold">Govee extras (optional)</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        Scenes, music mode and DreamView aren&apos;t available over Matter. Add a Govee API key to control them from a
        light&apos;s detail screen. Get one in the Govee Home app: Profile → Settings → Apply for API Key. This uses
        Govee&apos;s cloud.
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
      <Button title="Save key" disabled={!draft.trim()} onPress={check} />
      {key && (
        <Button
          title="Remove key"
          color="#E5484D"
          onPress={() => {
            save(null);
            setNote(undefined);
          }}
        />
      )}
      {note && <ThemedText type="small">{note}</ThemedText>}
    </Card>
  );
}
