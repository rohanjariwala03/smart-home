import * as WebBrowser from 'expo-web-browser';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Button,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  TextInput,
  View,
} from 'react-native';

import { Card } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useHA } from '@/ha';
import { useTheme } from '@/hooks/use-theme';
import {
  ADMIN_ONLY,
  fill,
  flows,
  ignoreFlow,
  listIntegrations,
  useDiscovered,
  useTranslations,
  type Field,
  type Step,
} from '@/setup';

export type SheetStart = 'brand' | 'matter' | { flowId: string } | { handler: string };

// One modal for the whole add-device journey; iOS can't present a second sheet while one is open.
export function AddDeviceSheet({ start, onClose }: { start: SheetStart; onClose: () => void }) {
  const [mode, setMode] = useState(start);

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <ThemedView style={styles.sheet}>
        <View style={styles.close}>
          <Pressable onPress={onClose} accessibilityRole="button" hitSlop={12}>
            <ThemedText type="linkPrimary">Close</ThemedText>
          </Pressable>
        </View>
        {mode === 'brand' ? (
          <BrandPicker onPick={(handler) => setMode({ handler })} />
        ) : mode === 'matter' ? (
          <MatterPair onDone={onClose} />
        ) : (
          <FlowView {...mode} onDone={onClose} />
        )}
      </ThemedView>
    </Modal>
  );
}

/** Discovered devices with Set up / Ignore. Renders nothing when there are none. */
export function DiscoveredList({ onSetUp }: { onSetUp: (flowId: string) => void }) {
  const { conn } = useHA();
  const discovered = useDiscovered();
  if (!discovered.length) return null;

  return (
    <>
      <ThemedText type="smallBold">Found on your network</ThemedText>
      {discovered.map(({ flow, title }) => (
        <View key={flow.flow_id} style={styles.row}>
          <ThemedText style={styles.flex} numberOfLines={2}>
            {title}
          </ThemedText>
          <Button
            title="Ignore"
            color="#888"
            onPress={() =>
              conn && ignoreFlow(conn, flow.flow_id, title).catch((e) => Alert.alert('Could not ignore', e?.message ?? String(e)))
            }
          />
          <Button title="Set up" onPress={() => onSetUp(flow.flow_id)} />
        </View>
      ))}
    </>
  );
}

function BrandPicker({ onPick }: { onPick: (domain: string) => void }) {
  const { conn } = useHA();
  const theme = useTheme();
  const [all, setAll] = useState<{ domain: string; name: string }[]>();
  const [error, setError] = useState<string>();
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (conn) listIntegrations(conn).then(setAll, (e) => setError(e?.code === 'unauthorized' ? ADMIN_ONLY : String(e?.message ?? e)));
  }, [conn]);

  const q = query.trim().toLowerCase();
  const shown = all?.filter((i) => i.name.toLowerCase().includes(q) || i.domain.includes(q));

  return (
    <>
      <ThemedText type="subtitle">Add device</ThemedText>
      <TextInput
        style={[styles.input, { color: theme.text, borderColor: theme.textSecondary }]}
        value={query}
        onChangeText={setQuery}
        placeholder="Search brands, e.g. TP-Link, Govee, Hue"
        placeholderTextColor={theme.textSecondary}
        autoCorrect={false}
        clearButtonMode="while-editing"
      />
      {error && <ThemedText themeColor="textSecondary">{error}</ThemedText>}
      {!all && !error && <ActivityIndicator />}
      <FlatList
        data={shown}
        keyExtractor={(i) => i.domain}
        keyboardShouldPersistTaps="handled"
        renderItem={({ item }) => (
          <Pressable onPress={() => onPick(item.domain)} style={styles.listItem} accessibilityRole="button">
            <ThemedText>{item.name}</ThemedText>
          </Pressable>
        )}
      />
    </>
  );
}

// Devices already set up in another app (Govee, Alexa, Apple Home…) share a pairing code and
// join over Wi-Fi. Brand-new Matter devices pair over Bluetooth, which only the HA app can do.
function MatterPair({ onDone }: { onDone: () => void }) {
  const { conn } = useHA();
  const theme = useTheme();
  const [code, setCode] = useState('');
  const [state, setState] = useState<'idle' | 'busy' | 'done'>('idle');
  const [error, setError] = useState<string>();

  const pair = () => {
    if (!conn) return;
    setState('busy');
    setError(undefined);
    conn
      .sendMessagePromise({ type: 'matter/commission', code: code.replace(/[\s-]/g, ''), network_only: true })
      .then(
        () => setState('done'),
        (e) => {
          setState('idle');
          setError(
            e?.code === 'unauthorized'
              ? ADMIN_ONLY
              : e?.code === 'unknown_command'
                ? 'Matter isn\'t set up in Home Assistant yet. Add the "Matter" integration first (Add by brand › Matter).'
                : `Couldn't pair: ${e?.message ?? e}. Check the code hasn't expired and the device is on your Wi-Fi.`,
          );
        },
      );
  };

  if (state === 'done') {
    return (
      <Card>
        <ThemedText type="subtitle">Paired ✓</ThemedText>
        <ThemedText>It shows up on Home in a few seconds.</ThemedText>
        <Button title="Done" onPress={onDone} />
      </Card>
    );
  }

  return (
    <>
      <ThemedText type="subtitle">Matter pairing code</ThemedText>
      <ThemedText themeColor="textSecondary">
        In the device&apos;s own app (Govee, Alexa, Apple Home…) choose Matter › share with another app, then enter the
        11-digit code here. Brand-new devices that have never been set up pair over Bluetooth: use the Home Assistant
        app for those.
      </ThemedText>
      <TextInput
        style={[styles.input, { color: theme.text, borderColor: theme.textSecondary }]}
        value={code}
        onChangeText={setCode}
        placeholder="1234-567-8901 or MT:…"
        placeholderTextColor={theme.textSecondary}
        autoCapitalize="characters"
        autoCorrect={false}
        editable={state === 'idle'}
      />
      {error && <ThemedText themeColor="textSecondary">{error}</ThemedText>}
      {state === 'busy' ? (
        <View style={styles.row}>
          <ActivityIndicator />
          <ThemedText themeColor="textSecondary">Pairing… this can take a minute.</ThemedText>
        </View>
      ) : (
        <Button title="Pair" disabled={code.replace(/\D/g, '').length < 11 && !code.startsWith('MT:')} onPress={pair} />
      )}
    </>
  );
}

// Walks one config flow: form → (menu / progress / browser sign-in) → added or aborted.
function FlowView({ flowId, handler, onDone }: { flowId?: string; handler?: string; onDone: () => void }) {
  const { creds } = useHA();
  const [step, setStep] = useState<Step>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const latest = useRef<Step | undefined>(undefined);
  const domain = step?.translation_domain ?? step?.handler ?? handler ?? '';
  const tr = useTranslations(domain ? [domain] : []);
  const t = (key: string) => fill(tr[`component.${domain}.${key}`], step?.description_placeholders);

  useEffect(() => {
    if (!creds) return;
    const api = flows(creds);
    (flowId ? api.get(flowId) : api.start(handler!)).then(
      (s) => {
        latest.current = s;
        setStep(s);
      },
      (e) => setError(e.message),
    );
    return () => {
      // Don't leave half-done flows the user started; discovered ones stay in the list.
      const s = latest.current;
      if (handler && s && !['create_entry', 'abort'].includes(s.type)) api.abort(s.flow_id);
    };
  }, [creds, flowId, handler]);

  // Steps that finish on HA's side (sign-in in the browser, long-running work): poll until they move on.
  useEffect(() => {
    if (!creds || !step || !['progress', 'external', 'progress_done', 'external_done'].includes(step.type)) return;
    const wait = step.type.endsWith('_done') ? 0 : 2000;
    const id = setInterval(() => {
      flows(creds)
        .get(step.flow_id)
        .then(
          (s) => {
            if (s.type === step.type) return;
            latest.current = s;
            setStep(s);
          },
          (e) => setError(e.message),
        );
    }, wait);
    return () => clearInterval(id);
  }, [creds, step]);

  const submit = (data: object) => {
    if (!creds || !step) return;
    setBusy(true);
    flows(creds)
      .submit(step.flow_id, data)
      .then(
        (r) => {
          if ('type' in r) latest.current = r;
          setStep('type' in r ? r : { ...step, errors: r.errors });
        },
        (e) => setError(e.message),
      )
      .finally(() => setBusy(false));
  };

  if (error) return <ThemedText themeColor="textSecondary">{error}</ThemedText>;
  if (!step) return <ActivityIndicator />;

  const title = t(`config.step.${step.step_id}.title`) ?? t('config.flow_title') ?? 'Add device';
  const description = t(`config.step.${step.step_id}.description`);

  switch (step.type) {
    case 'form':
      return (
        <ScrollView contentContainerStyle={styles.gap} keyboardShouldPersistTaps="handled">
          <ThemedText type="subtitle">{title}</ThemedText>
          {description && <ThemedText themeColor="textSecondary">{description}</ThemedText>}
          <Form key={`${step.flow_id}:${step.step_id}`} step={step} t={t} busy={busy} onSubmit={submit} />
        </ScrollView>
      );
    case 'menu': {
      const opts = Array.isArray(step.menu_options)
        ? step.menu_options.map((o) => [o, t(`config.step.${step.step_id}.menu_options.${o}`) ?? o] as const)
        : Object.entries(step.menu_options ?? {});
      return (
        <View style={styles.gap}>
          <ThemedText type="subtitle">{title}</ThemedText>
          {description && <ThemedText themeColor="textSecondary">{description}</ThemedText>}
          {opts.map(([id, label]) => (
            <Card key={id}>
              <Button title={label} disabled={busy} onPress={() => submit({ next_step_id: id })} />
            </Card>
          ))}
        </View>
      );
    }
    case 'create_entry':
      return (
        <Card>
          <ThemedText type="subtitle">Added ✓</ThemedText>
          <ThemedText>{step.title ? `${step.title} is set up. ` : ''}Its devices appear on Home in a few seconds.</ThemedText>
          <Button title="Done" onPress={onDone} />
        </Card>
      );
    case 'abort':
      return (
        <Card>
          <ThemedText type="subtitle">Not added</ThemedText>
          <ThemedText>{t(`config.abort.${step.reason}`) ?? step.reason}</ThemedText>
          <Button title="Done" onPress={onDone} />
        </Card>
      );
    case 'external':
      return (
        <Card>
          <ThemedText type="subtitle">{title}</ThemedText>
          <ThemedText>Sign in with the device&apos;s account in the browser, then come back here.</ThemedText>
          {step.url && <Button title="Open sign-in" onPress={() => WebBrowser.openBrowserAsync(step.url!)} />}
          <ActivityIndicator />
        </Card>
      );
    default:
      return (
        <View style={[styles.row, styles.gap]}>
          <ActivityIndicator />
          <ThemedText themeColor="textSecondary">{t(`config.progress.${step.progress_action}`) ?? 'Working…'}</ThemedText>
        </View>
      );
  }
}

// Fields in collapsible sections ("expandable") are flattened to "section.field" and nested back on submit.
const flatten = (schema: Field[] = [], prefix = ''): [string, Field][] =>
  schema.flatMap((f) => (f.type === 'expandable' && f.schema ? flatten(f.schema, `${prefix}${f.name}.`) : [[prefix + f.name, f]]));

function kind(f: Field) {
  const s = f.selector ?? {};
  if (f.type === 'constant') return 'constant';
  if (f.type === 'boolean' || s.boolean) return 'bool';
  if (f.type === 'integer' || f.type === 'float' || s.number) return 'number';
  if (f.type === 'multi_select' || s.select?.multiple) return 'multi';
  if (f.type === 'select' || s.select) return 'select';
  if (s.text?.type === 'password' || /password|pin|secret/i.test(f.name)) return 'password';
  return 'text';
}

const options = (f: Field, t: (key: string) => string | undefined): [string, string][] =>
  Array.isArray(f.options)
    ? f.options
    : f.options
      ? Object.entries(f.options)
      : (f.selector?.select?.options ?? []).map((o: string | { value: string; label: string }) => {
          const value = typeof o === 'string' ? o : o.value;
          const fallback = typeof o === 'string' ? o.replace(/_/g, ' ') : o.label;
          return [value, t(`selector.${f.selector?.select?.translation_key}.options.${value}`) ?? fallback];
        });

function Form({ step, t, busy, onSubmit }: {
  step: Step;
  t: (key: string) => string | undefined;
  busy: boolean;
  onSubmit: (data: object) => void;
}) {
  const theme = useTheme();
  const fields = flatten(step.data_schema).filter(([, f]) => kind(f) !== 'constant');
  const [values, setValues] = useState<Record<string, any>>(() =>
    Object.fromEntries(fields.map(([path, f]) => [path, f.default ?? f.description?.suggested_value ?? (kind(f) === 'bool' ? false : undefined)])),
  );
  const set = (path: string, v: unknown) => setValues((prev) => ({ ...prev, [path]: v }));
  const label = (path: string) => {
    const parts = path.split('.');
    const key = parts.length > 1 ? `sections.${parts[0]}.data.${parts[1]}` : `data.${path}`;
    return t(`config.step.${step.step_id}.${key}`) ?? parts.at(-1)!.replace(/_/g, ' ');
  };
  // Schema validation errors can be lists of messages rather than translation keys.
  const errorText = (code?: string | string[]) => code && (t(`config.error.${code}`) ?? String(code));
  const missing = fields.some(([path, f]) => f.required && (values[path] === undefined || values[path] === ''));

  const submit = () => {
    const data: Record<string, any> = {};
    for (const [path, f] of fields) {
      let v = values[path];
      if (v === undefined || v === '') continue;
      if (kind(f) === 'number') v = Number(v);
      const parts = path.split('.');
      let target = data;
      for (const p of parts.slice(0, -1)) target = target[p] ??= {};
      target[parts.at(-1)!] = v;
    }
    onSubmit(data);
  };

  return (
    <View style={styles.gap}>
      {step.errors?.base && <ThemedText style={styles.error}>{errorText(step.errors.base)}</ThemedText>}
      {fields.map(([path, f]) => {
        const k = kind(f);
        const v = values[path];
        return (
          <View key={path} style={styles.field}>
            {k === 'bool' ? (
              <View style={styles.row}>
                <ThemedText style={styles.flex}>{label(path)}</ThemedText>
                <Switch value={!!v} onValueChange={(on) => set(path, on)} />
              </View>
            ) : (
              <>
                <ThemedText type="small">
                  {label(path)}
                  {f.required ? '' : ' (optional)'}
                </ThemedText>
                {k === 'select' || k === 'multi' ? (
                  <View style={styles.pills}>
                    {options(f, t).map(([value, text]) => {
                      const selected = k === 'multi' ? (v ?? []).includes(value) : v === value;
                      return (
                        <Pressable
                          key={value}
                          accessibilityRole="button"
                          accessibilityState={{ selected }}
                          onPress={() =>
                            set(
                              path,
                              k === 'multi'
                                ? selected
                                  ? v.filter((x: string) => x !== value)
                                  : [...(v ?? []), value]
                                : value,
                            )
                          }
                          style={[
                            styles.pill,
                            { borderColor: theme.textSecondary },
                            selected && { backgroundColor: theme.backgroundSelected },
                          ]}>
                          <ThemedText type="small">{text}</ThemedText>
                        </Pressable>
                      );
                    })}
                  </View>
                ) : (
                  <TextInput
                    style={[styles.input, { color: theme.text, borderColor: theme.textSecondary }]}
                    value={v === undefined ? '' : String(v)}
                    onChangeText={(text) => set(path, text)}
                    secureTextEntry={k === 'password'}
                    keyboardType={k === 'number' ? 'decimal-pad' : 'default'}
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                )}
              </>
            )}
            {step.errors?.[path.split('.').at(-1)!] && (
              <ThemedText type="small" style={styles.error}>
                {errorText(step.errors[path.split('.').at(-1)!])}
              </ThemedText>
            )}
          </View>
        );
      })}
      {busy ? <ActivityIndicator /> : <Button title="Next" disabled={missing} onPress={submit} />}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  sheet: { flex: 1, padding: Spacing.three, gap: Spacing.three },
  close: { alignItems: 'flex-end' },
  gap: { gap: Spacing.three },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  field: { gap: Spacing.one },
  input: { borderWidth: 1, borderRadius: 10, padding: Spacing.two, fontSize: 16 },
  listItem: { paddingVertical: 12 },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  pill: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  error: { color: '#E5484D' },
});
