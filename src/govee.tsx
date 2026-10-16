import * as SecureStore from 'expo-secure-store';
import { useEffect, useState } from 'react';
import { StyleSheet, Switch, View } from 'react-native';

import { Chip } from '@/components/chip';
import { Card } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import type { Device } from '@/ha';

// Govee's cloud API, for what Matter doesn't carry: scenes, music mode, DreamView (TV sync).
// Optional: only used once the user saves an API key from the Govee Home app.
// This talks to Govee's servers directly; on/off, brightness and colour still go through HA.

const API = 'https://openapi.api.govee.com/router/api/v1';
const KEY = 'govee-key';

type Option = { name: string; value: unknown };
type Cap = {
  type: string;
  instance: string;
  parameters?: { options?: Option[]; fields?: { fieldName: string; options?: Option[] }[] };
  state?: { value: unknown };
};
export type GoveeDevice = { sku: string; device: string; deviceName: string; type: string; capabilities: Cap[] };

async function api(key: string, path: string, payload?: object) {
  const res = await fetch(API + path, {
    method: payload ? 'POST' : 'GET',
    headers: { 'Govee-API-Key': key, 'Content-Type': 'application/json' },
    body: payload && JSON.stringify({ requestId: String(Date.now()), payload }),
  });
  const json = await res.json().catch(() => ({}));
  if (json.code !== 200) throw new Error(json.msg ?? json.message ?? `Govee returned ${res.status}`);
  return json;
}

export const listGovee = (key: string): Promise<GoveeDevice[]> => api(key, '/user/devices').then((j) => j.data);

const caps = (key: string, path: string, d: GoveeDevice): Promise<Cap[]> =>
  api(key, path, { sku: d.sku, device: d.device }).then((j) => j.payload?.capabilities ?? []);

export function useGoveeKey() {
  const [key, setKey] = useState<string | null>();
  useEffect(() => {
    SecureStore.getItemAsync(KEY).then(setKey);
  }, []);
  const save = async (next: string | null) => {
    if (next) await SecureStore.setItemAsync(KEY, next);
    else await SecureStore.deleteItemAsync(KEY);
    setKey(next);
  };
  return { key, save };
}

// HA knows the light as a Matter device; find the same light in the Govee account.
function match(list: GoveeDevice[], device: Device) {
  const lights = list.filter((d) => d.type === 'devices.types.light');
  const named = device.name_by_user ?? device.name;
  return (
    list.find((d) => d.sku === device.model) ??
    list.find((d) => d.deviceName === named) ??
    (lights.length === 1 ? lights[0] : undefined)
  );
}

export type GoveeStep = { sku: string; device: string; type: string; instance: string; value: unknown; name: string; light?: string };

/** What a scene can ask of this light through Govee: its toggles (DreamView…) and every scene, DIY ones too. */
export async function goveeOptions(key: string, device: Device): Promise<GoveeStep[]> {
  const d = match(await listGovee(key), device);
  if (!d) return [];
  const step = (c: Cap, name: string, value: unknown) => ({ sku: d.sku, device: d.device, type: c.type, instance: c.instance, value, name });
  const scenes = (
    await Promise.all([caps(key, '/device/scenes', d).catch(() => []), caps(key, '/device/diy-scenes', d).catch(() => [])])
  ).flat();
  return [
    ...d.capabilities.filter((c) => c.type === 'devices.capabilities.toggle').map((c) => step(c, `${label(c.instance)} on`, 1)),
    ...scenes.flatMap((c) => (c.parameters?.options ?? []).map((o) => step(c, o.name, o.value))),
  ];
}

export const goveeRun = (key: string, s: GoveeStep) =>
  api(key, '/device/control', { sku: s.sku, device: s.device, capability: { type: s.type, instance: s.instance, value: s.value } });

export const goveeKey = () => SecureStore.getItemAsync(KEY);

const label = (instance: string) =>
  instance === 'dreamViewToggle'
    ? 'DreamView (sync with TV)'
    : instance.replace(/Toggle$/, '').replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());

const SHOWN = 12;

export function GoveeCard({ device }: { device?: Device }) {
  const { key } = useGoveeKey();
  const [dev, setDev] = useState<GoveeDevice>();
  const [extra, setExtra] = useState<Cap[]>([]); // scene lists come from separate endpoints
  const [state, setState] = useState<Record<string, unknown>>({});
  const [all, setAll] = useState(false);
  const [error, setError] = useState<string>();
  const isGovee = !!device?.manufacturer?.toLowerCase().includes('govee');

  useEffect(() => {
    if (!key || !device || !isGovee) return;
    let cancelled = false;
    listGovee(key)
      .then(async (list) => {
        const d = match(list, device);
        if (!d) throw new Error('This light isn’t in your Govee account.');
        const [scenes, diy, current] = await Promise.all([
          caps(key, '/device/scenes', d).catch(() => []),
          caps(key, '/device/diy-scenes', d).catch(() => []),
          caps(key, '/device/state', d).catch(() => []),
        ]);
        if (cancelled) return;
        setDev(d);
        setExtra([...scenes, ...diy]);
        setState(Object.fromEntries(current.map((c) => [c.instance, c.state?.value])));
      })
      .catch((e) => !cancelled && setError(e?.message ?? String(e)));
    return () => {
      cancelled = true;
    };
  }, [key, device, isGovee]);

  if (!isGovee || !key) return null;

  const control = (cap: Cap, value: unknown) => {
    if (!dev) return;
    setError(undefined);
    api(key, '/device/control', { sku: dev.sku, device: dev.device, capability: { type: cap.type, instance: cap.instance, value } })
      .then(() => setState((s) => ({ ...s, [cap.instance]: value })))
      .catch((e) => setError(e?.message ?? String(e)));
  };

  // Scene lists from their own endpoints replace the (often empty) ones in the device list.
  const allCaps = Object.values(Object.fromEntries([...(dev?.capabilities ?? []), ...extra].map((c) => [c.instance, c])));
  const toggles = allCaps.filter((c) => c.type === 'devices.capabilities.toggle');
  const scenes = allCaps.filter((c) => c.type === 'devices.capabilities.dynamic_scene' && c.parameters?.options?.length);
  const music = allCaps.find((c) => c.instance === 'musicMode');
  const modes = music?.parameters?.fields?.find((f) => f.fieldName === 'musicMode')?.options ?? [];

  return (
    <Card>
      <ThemedText type="smallBold">Govee</ThemedText>
      {!dev && !error && (
        <ThemedText type="small" themeColor="textSecondary">
          Loading from Govee…
        </ThemedText>
      )}

      {toggles.map((c) => (
        <View key={c.instance} style={styles.row}>
          <ThemedText style={styles.flex}>{label(c.instance)}</ThemedText>
          <Switch value={state[c.instance] === 1} onValueChange={(on) => control(c, on ? 1 : 0)} />
        </View>
      ))}

      {scenes.map((c) => {
        const options = c.parameters!.options!;
        const shown = all ? options : options.slice(0, SHOWN);
        return (
          <View key={c.instance} style={styles.section}>
            <ThemedText themeColor="textSecondary">
              {c.instance === 'diyScene' ? 'My scenes' : c.instance === 'snapshot' ? 'Snapshots' : 'Scenes'}
            </ThemedText>
            <View style={styles.wrap}>
              {shown.map((o, i) => (
                <Chip key={`${i}-${o.name}`} label={o.name} onPress={() => control(c, o.value)} />
              ))}
              {options.length > SHOWN && !all && <Chip label={`All ${options.length}…`} onPress={() => setAll(true)} />}
            </View>
          </View>
        );
      })}

      {music && modes.length > 0 && (
        <View style={styles.section}>
          <ThemedText themeColor="textSecondary">Music mode</ThemedText>
          <View style={styles.wrap}>
            {modes.map((o) => (
              <Chip
                key={o.name}
                icon="music.note"
                label={o.name}
                onPress={() => control(music, { musicMode: o.value, sensitivity: 100, autoColor: 1 })}
              />
            ))}
          </View>
        </View>
      )}

      {error && (
        <ThemedText type="small" style={styles.error}>
          {error}
        </ThemedText>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  section: { gap: Spacing.two },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  error: { color: '#E5484D' },
});
