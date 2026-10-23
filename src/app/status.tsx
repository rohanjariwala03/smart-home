import { SymbolView, type SFSymbol } from 'expo-symbols';
import type { HassEntity } from 'home-assistant-js-websocket';
import { useEffect, useState } from 'react';
import { StyleSheet, Switch, View } from 'react-native';

import {
  binaries,
  blinkPoll,
  blinkSignedOut,
  SIGN_IN_AGAIN,
  HEALTH_ID,
  mainEntities,
  removeAutomation,
  setHealthAlerts,
  useAutomation,
  useAutomationConfig,
  useNotifyServices,
  watched,
  watchedOf,
  without,
} from '@/automations';
import { stateText } from '@/components/device-sheet';
import { EnergyCard } from '@/components/energy-card';
import { Card, Disclosure, Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { byDomain, deviceName, name, unavailable, useHA } from '@/ha';

type Tone = 'ok' | 'warn' | 'bad' | 'none';
const TONE: Record<Tone, string> = { ok: '#30D158', warn: '#FF9F0A', bad: '#FF453A', none: '#8E8E93' };

/** HA, Blink and devices at a glance, like HA's own device pages; and live power/energy. */
export default function StatusScreen() {
  const { conn, status, entities, devices } = useHA();

  const offline = mainEntities(entities, devices).filter((e) => e.state === 'unavailable');
  const offlineNames = [...new Set(offline.map((e) => deviceName(devices[e.entity_id]) ?? name(e)))];
  const connections = binaries(entities, 'connectivity');
  const batteries = [
    ...binaries(entities, 'battery'),
    ...byDomain(entities, 'sensor').filter((e) => e.attributes.device_class === 'battery'),
  ];
  const low = batteries.filter(isLow);
  const updates = byDomain(entities, 'update').filter((e) => e.state === 'on');
  // Blink snapshot cameras; an offline one has lost its attributes but still belongs here, as Offline.
  const cameras = byDomain(entities, 'camera').filter(
    (e) => !e.entity_id.endsWith('_live_view') && (e.attributes.snapshot_of || devices[e.entity_id]?.manufacturer === 'Blink'),
  );
  const problems = Number(blinkSignedOut(entities)) + offlineNames.length + connections.filter((e) => e.state !== 'on').length + low.length + (status === 'ready' ? 0 : 1);

  return (
    <Screen title="Status" subtitle={problems ? `${problems} need${problems === 1 ? 's' : ''} attention` : 'Everything looks good'}>
      <Card>
        <ThemedText type="smallBold">Home Assistant</ThemedText>
        <Row icon="house.fill" label="Connection" value={status === 'ready' ? 'Connected' : status} tone={status === 'ready' ? 'ok' : 'bad'} />
        {conn && <Row icon="info.circle" label="Version" value={conn.haVersion} />}
        <Row
          icon="arrow.down.circle"
          label="Updates"
          value={updates.length ? updates.map(name).join(', ') : 'Up to date'}
          tone={updates.length ? 'warn' : 'ok'}
        />
      </Card>

      {connections.length > 0 && (
        <Card>
          <ThemedText type="smallBold">Connections</ThemedText>
          {connections.map((e) => (
            <Row
              key={e.entity_id}
              icon="antenna.radiowaves.left.and.right"
              label={name(e).replace(/ Connection$/, '')}
              value={unavailable(e) ? 'Unknown' : e.state === 'on' ? 'Connected' : 'Disconnected'}
              tone={e.state === 'on' ? 'ok' : 'bad'}
            />
          ))}
          <BlinkPoll entity={blinkPoll(entities)} />
        </Card>
      )}

      {cameras.map((e) => (
        <CameraHealth key={e.entity_id} camera={e} />
      ))}

      <Card>
        <ThemedText type="smallBold">Devices</ThemedText>
        {offlineNames.length ? (
          offlineNames.map((n) => <Row key={n} icon="wifi.slash" label={n} value="Offline" tone="bad" />)
        ) : (
          <Row icon="checkmark.circle" label="All devices online" tone="ok" />
        )}
        {batteries.map((e) => (
          <Row
            key={e.entity_id}
            icon={isLow(e) ? 'battery.25percent' : 'battery.100percent'}
            label={(deviceName(devices[e.entity_id]) ?? name(e)).replace(/ Battery$/, '')}
            value={batteryText(e)}
            tone={unavailable(e) ? 'none' : isLow(e) ? 'bad' : 'ok'}
          />
        ))}
      </Card>

      <HealthAlerts />
      <EnergyCard />
    </Screen>
  );
}

function isLow(e: HassEntity) {
  if (e.entity_id.startsWith('binary_sensor.')) return e.state === 'on';
  const n = Number(e.state);
  return Number.isFinite(n) && n < 20;
}

function batteryText(e?: HassEntity) {
  if (!e || unavailable(e)) return 'Unknown';
  if (e.entity_id.startsWith('sensor.')) return `${Math.round(Number(e.state))}%`;
  const level = e.attributes.battery_level ?? e.attributes.battery_state;
  return `${e.state === 'on' ? 'Low' : 'OK'}${level && !/^(ok|low)$/i.test(String(level)) ? ` · ${level}` : ''}`;
}

function ago(when?: string | number | null) {
  if (when == null || when === '') return undefined;
  const t = typeof when === 'number' && when < 1e12 ? when * 1000 : new Date(when).getTime();
  if (!Number.isFinite(t)) return String(when);
  const min = Math.round((Date.now() - t) / 60e3);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  if (min < 24 * 60) return `${Math.round(min / 60)} h ago`;
  return new Date(t).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function BlinkPoll({ entity }: { entity?: HassEntity }) {
  if (!entity) return null;
  const failures = Number(entity.attributes.failures) || 0;
  return (
    <>
      {entity.attributes.state === 'auth_failed' && (
        <>
          <Row icon="person.crop.circle.badge.exclamationmark" label="Blink sign-in" value="Expired" tone="bad" />
          <ThemedText type="small" style={{ color: TONE.bad }}>{SIGN_IN_AGAIN}</ThemedText>
        </>
      )}
      <Row
        icon="arrow.triangle.2.circlepath"
        label="Last Blink check"
        value={ago(entity.state) ?? 'Never'}
        tone={failures ? 'warn' : 'ok'}
      />
      {failures > 0 && (
        <ThemedText type="small" style={{ color: TONE.warn }}>
          {failures} failed check{failures === 1 ? '' : 's'}
          {entity.attributes.last_error ? `: ${entity.attributes.last_error}` : ''}
        </ThemedText>
      )}
    </>
  );
}

// Wi-Fi from the proxy: dBm on most cameras, 0–5 bars on some.
function wifi(e?: HassEntity): [string, Tone] {
  if (!e || unavailable(e)) return ['Unknown', 'none'];
  const n = Number(e.state);
  if (n >= 0 && n <= 5) return [`${n} of 5 bars`, n >= 3 ? 'ok' : n >= 2 ? 'warn' : 'bad'];
  const [word, tone]: [string, Tone] = n >= -55 ? ['Excellent', 'ok'] : n >= -65 ? ['Good', 'ok'] : n >= -75 ? ['Fair', 'warn'] : ['Weak', 'bad'];
  return [`${word} · ${n} dBm`, tone];
}

/** One Blink camera, like its device page in HA: connection, battery, signal, temperature, motion. */
function CameraHealth({ camera }: { camera: HassEntity }) {
  const { entities } = useHA();
  const obj = camera.entity_id.split('.')[1]; // <area>_<slug>, e.g. cameras_outdoor
  const slug = camera.attributes.snapshot_of;
  const live = Object.values(entities).find((e) => e.entity_id.startsWith('camera.') && e.attributes.proxy_slug === slug);
  const get = (id: string) => entities[id] as HassEntity | undefined;
  const battery = get(`binary_sensor.${obj}_battery`);
  const voltage = get(`sensor.${obj}_battery_voltage`);
  const temperature = get(`sensor.${obj}_temperature`);
  const motion = get(`binary_sensor.${obj}_motion`);
  const detection = get(`switch.${obj}_motion_detection`);
  const [signal, signalTone] = wifi(get(`sensor.${obj}_wifi_signal`));
  const offline = unavailable(camera) && unavailable(live);
  const signedOut = blinkSignedOut(entities);
  const model = live?.attributes.product_type ?? live?.attributes.camera_type;
  const summary = [
    battery && `Battery ${batteryText(battery)}`,
    signal !== 'Unknown' && signal.split(' · ')[0],
    temperature && !unavailable(temperature) && stateText(temperature),
  ].filter(Boolean).join(' · ');

  return (
    <Card>
      <View style={styles.row}>
        <ThemedText type="smallBold" style={styles.flex}>{name(camera)}</ThemedText>
        <Pill tone={offline || signedOut ? 'bad' : 'ok'} label={signedOut ? 'Blink signed out' : offline ? 'Offline' : 'Online'} />
      </View>
      <Disclosure title={model ? `Blink ${model}` : 'Details'} summary={summary}>
        {battery && (
          <Row
            icon={isLow(battery) ? 'battery.25percent' : 'battery.100percent'}
            label="Battery"
            value={[batteryText(battery), voltage && !unavailable(voltage) && stateText(voltage)].filter(Boolean).join(' · ')}
            tone={unavailable(battery) ? 'none' : isLow(battery) ? 'bad' : 'ok'}
          />
        )}
        <Row icon="wifi" label="Wi-Fi signal" value={signal} tone={signalTone} />
        {temperature && <Row icon="thermometer.medium" label="Temperature" value={stateText(temperature)} />}
        {detection && (
          <Row
            icon="figure.walk.motion"
            label="Motion detection"
            value={unavailable(detection) ? 'Unknown' : detection.state === 'on' ? 'On' : 'Off'}
            tone={detection.state === 'on' ? 'ok' : 'warn'}
          />
        )}
        {motion && <Row icon="video.fill" label="Last motion clip" value={ago(motion.attributes.last_record) ?? 'None yet'} />}
        <Row icon="photo" label="Snapshot taken" value={ago(camera.attributes.snapshot_taken) ?? ago(camera.last_updated)} />
        {live?.attributes.ptt_supported !== undefined && (
          <Row icon="mic.fill" label="Two-way talk" value={live.attributes.ptt_supported ? 'Supported' : 'Not on this model'} />
        )}
      </Disclosure>
    </Card>
  );
}

/** One switch for the phone alert; its watch list follows the devices in HA. */
function HealthAlerts() {
  const { creds, entities, devices } = useHA();
  const notify = useNotifyServices();
  const auto = useAutomation(HEALTH_ID);
  const config = useAutomationConfig(HEALTH_ID);
  const [error, setError] = useState<string>();
  const want = watched(entities, devices);
  const skip: string[] = config?.variables?.skip ?? [];
  const key = JSON.stringify(without(want, skip));
  // The ids the saved automation watches, to spot devices added since.
  const savedKey = config && JSON.stringify(watchedOf(config.triggers));
  const target = config?.actions?.[0]?.action ?? notify[0];

  // Keep the watch list current: re-save when devices were added or removed in HA.
  useEffect(() => {
    if (creds && auto && savedKey && target && savedKey !== key && Object.keys(devices).length) setHealthAlerts(creds, target, want, skip).catch(() => {});
  }, [creds, auto, savedKey, key, target]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!creds) return null;
  const toggle = (on: boolean) => {
    setError(undefined);
    (on ? setHealthAlerts(creds, notify[0], want, skip) : removeAutomation(creds, HEALTH_ID)).catch((e) => setError(e?.message ?? String(e)));
  };

  return (
    <Card>
      <View style={styles.row}>
        <View style={styles.flex}>
          <ThemedText>Alert me when something needs attention</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            A device or camera offline for 5 minutes, a Blink connection dropping, a low battery, or Home Assistant restarting. To leave a device out, turn off its alert in its settings.
          </ThemedText>
        </View>
        <Switch value={!!auto} disabled={!notify.length} onValueChange={toggle} />
      </View>
      {!notify.length && (
        <ThemedText type="small" themeColor="textSecondary">Needs the Home Assistant app on this phone, signed in to your home.</ThemedText>
      )}
      <ThemedText type="small" themeColor="textSecondary">
        If Home Assistant itself stops, it can’t send alerts. This screen shows it as not connected.
      </ThemedText>
      {error && <ThemedText type="small" style={{ color: TONE.bad }}>{error}</ThemedText>}
    </Card>
  );
}

function Row({ icon, label, value, tone = 'none' }: { icon: SFSymbol; label: string; value?: string; tone?: Tone }) {
  return (
    <View style={styles.row} accessible accessibilityLabel={`${label}${value ? `: ${value}` : ''}`}>
      <SymbolView name={icon} size={18} tintColor={TONE[tone]} />
      <ThemedText style={styles.flex} numberOfLines={1}>{label}</ThemedText>
      {value !== undefined && (
        <ThemedText themeColor="textSecondary" numberOfLines={2} style={styles.value}>
          {value}
        </ThemedText>
      )}
    </View>
  );
}

function Pill({ tone, label }: { tone: Tone; label: string }) {
  return (
    <View style={[styles.pill, { backgroundColor: `${TONE[tone]}33` }]}>
      <View style={[styles.dot, { backgroundColor: TONE[tone] }]} />
      <ThemedText type="small" style={{ color: TONE[tone] }}>{label}</ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, minHeight: 28 },
  value: { maxWidth: '55%', textAlign: 'right' },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  dot: { width: 8, height: 8, borderRadius: 4 },
});
