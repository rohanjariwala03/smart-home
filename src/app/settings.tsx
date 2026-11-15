import { useEffect, useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

import { findHomeAssistant, type FoundHA } from '../../modules/ha-discovery';

import { AddDeviceSheet, DiscoveredList, type SheetStart } from '@/components/add-device';
import { AnnounceSettings } from '@/components/announce-settings';
import { Chip } from '@/components/chip';
import { YourDevices } from '@/components/remove-devices';
import { Card, Disclosure, Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { WallSetting } from '@/components/wall';
import { Spacing } from '@/constants/theme';
import { listGovee, useGoveeKey } from '@/govee';
import { useHA } from '@/ha';
import { signIn } from '@/sign-in';
import { useTheme } from '@/hooks/use-theme';

export default function SettingsScreen() {
  const { creds, conn, status, error, entities, save } = useHA();
  const theme = useTheme();
  const [draftUrl, setUrl] = useState<string>();
  const url = draftUrl ?? creds?.url ?? '';
  const [token, setToken] = useState('');
  const [signing, setSigning] = useState<string>();
  const [found, setFound] = useState<FoundHA[]>();
  const look = () => findHomeAssistant().then(setFound, () => setFound([]));
  const search = () => {
    setFound(undefined);
    look();
  };
  useEffect(() => void look(), []);
  const [sheet, setSheet] = useState<SheetStart>();
  const input = [styles.input, { color: theme.text, borderColor: theme.textSecondary }];

  const trimmedUrl = url.trim().replace(/\/+$/, '');
  const nextToken = token.trim() || creds?.token || '';
  const urlOk = /^https?:\/\/.+/.test(trimmedUrl);
  const valid = urlOk && nextToken.length > 0;
  const ready = status === 'ready';

  // Until it's set up, connecting comes first.
  const haCard = (
    <Card>
      <ThemedText type="smallBold">Home Assistant</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {ready ? `Connected · ${conn?.haVersion ?? ''} · ${Object.keys(entities).length} entities` : status === 'no-config' ? 'Not set up yet' : `${status}${error ? ` (${error})` : ''}`}
      </ThemedText>
      <Disclosure title="Address & sign-in" summary={creds?.url} initiallyOpen={!creds}>
        <TextInput
          style={input}
          value={url}
          onChangeText={setUrl}
          placeholder="http://192.168.x.x:8123"
          placeholderTextColor={theme.textSecondary}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
        />
        <View style={styles.chips}>
          {found?.map((h) => (
            <Chip
              key={h.url}
              icon="house.fill"
              label={`${h.name} · ${h.url.replace(/^https?:\/\//, '')}`}
              selected={h.url.replace(/\/+$/, '') === trimmedUrl}
              onPress={() => setUrl(h.url)}
            />
          ))}
          <Chip
            icon="magnifyingglass"
            label={!found ? 'Looking on this Wi-Fi…' : found.length ? 'Search again' : 'None found · Search again'}
            disabled={!found}
            onPress={search}
          />
        </View>
        <View style={styles.chips}>
          <Chip
            icon="person.crop.circle.badge.checkmark"
            label={signing === 'Signing in…' ? signing : 'Sign in with Home Assistant'}
            selected
            disabled={!urlOk || signing === 'Signing in…'}
            onPress={async () => {
              setSigning('Signing in…');
              try {
                const next = await signIn(trimmedUrl);
                if (next) await save({ url: trimmedUrl, token: next });
                setSigning(undefined);
              } catch (e: any) {
                setSigning(`Couldn’t sign in: ${e?.message ?? e}`);
              }
            }}
          />
        </View>
        {signing && signing !== 'Signing in…' && <ThemedText type="small">{signing}</ThemedText>}
        <ThemedText type="small" themeColor="textSecondary">
          Opens your Home Assistant&apos;s own login page. The app then keeps a long-lived token, listed in your Home
          Assistant profile under Security, where you can revoke it. Home Assistant needs internet access for this
          step; if it has none, paste a token below.
        </ThemedText>
        <Disclosure title="Or paste a token" summary={creds ? 'Token saved' : undefined}>
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
              disabled={!valid}
              onPress={() => {
                save({ url: trimmedUrl, token: nextToken });
                setToken('');
              }}
            />
          </View>
          <ThemedText type="small" themeColor="textSecondary">
            Create one in Home Assistant: your profile › Security › Long-lived access tokens.
          </ThemedText>
        </Disclosure>
        <ThemedText type="small" themeColor="textSecondary">
          The token is stored in the iOS Keychain. Adding devices needs an admin user; for control only, a non-admin
          user is safer.
        </ThemedText>
      </Disclosure>
      <GoveeSettings />
    </Card>
  );

  return (
    <Screen title="Settings" readable>
      {!creds && haCard}
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

      <WallSetting />

      {creds && haCard}
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
