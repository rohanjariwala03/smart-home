import { getServices } from 'home-assistant-js-websocket';
import { useEffect, useState } from 'react';
import { Button, Linking, StyleSheet, View } from 'react-native';

import type { HassEntities, HassEntity } from 'home-assistant-js-websocket';

import {
  ANNOUNCE_ID,
  announceOf,
  blinkSignedOut,
  removeAutomation,
  setAnnounce,
  SIGN_IN_AGAIN,
  useAutomation,
  useAutomationConfig,
  watched,
  watchedOf,
  type Announce,
  type AnnounceCamera,
} from '@/automations';
import { AddDeviceSheet } from '@/components/add-device';
import { Row, Time } from '@/components/camera-automations';
import { Chip } from '@/components/chip';
import { Card } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { byDomain, name, unavailable, useHA } from '@/ha';

// Alexa Media Player (github.com/alandtse/alexa_media_player), installed from HACS.
const AMP_HACS = '/_my_redirect/hacs_repository?owner=alandtse&repository=alexa_media_player&category=integration';
const NONE: Announce = { echoes: [], cameras: [], health: false };

/** Alexa Media Player's Echos: each has a notify.alexa_media_<x> service and a media_player.<x> entity. */
function useEchoes() {
  const { conn, entities, devices } = useHA();
  const [services, setServices] = useState<string[]>();
  useEffect(() => {
    if (!conn) return;
    getServices(conn).then((all) => setServices(Object.keys(all.notify ?? {})), () => setServices([]));
  }, [conn]);
  if (!services) return undefined;
  return {
    installed: services.includes('alexa_media'),
    echoes: services.flatMap((s) => {
      const e = s.startsWith('alexa_media_') && entities[`media_player.${s.slice('alexa_media_'.length)}`];
      // The Alexa phone app shows up too ("This Device") but can't play announcements.
      return e && !devices[e.entity_id]?.model?.startsWith('Alexa Mobile') ? [e] : [];
    }),
  };
}

/** Speak alerts on Echo speakers, and how to have Siri read them on the iPhone. */
export function AnnounceSettings() {
  const { creds, conn, entities, call } = useHA();
  const found = useEchoes();
  const auto = useAutomation(ANNOUNCE_ID);
  const config = useAutomationConfig(ANNOUNCE_ID);
  const saved = announceOf(config);
  const [draft, setDraft] = useState<Announce>();
  const [setup, setSetup] = useState(false);
  const [note, setNote] = useState<string>();
  const a = draft ?? saved ?? NONE;

  // Cameras with motion (the proxy's snapshot cameras); the doorbell first.
  const cameras: AnnounceCamera[] = byDomain(entities, 'camera')
    .filter((e) => e.attributes.snapshot_of && entities[`binary_sensor.${e.entity_id.split('.')[1]}_motion`])
    .map((e) => ({
      motion: `binary_sensor.${e.entity_id.split('.')[1]}_motion`,
      name: name(e),
      doorbell: Object.values(entities).some(
        (l) => l.attributes.proxy_slug === e.attributes.snapshot_of && l.attributes.camera_type === 'doorbell',
      ),
    }))
    .sort((x, y) => Number(y.doorbell) - Number(x.doorbell));

  // Keep the health list current when devices are added (same as the phone health alert).
  const want = JSON.stringify(watched(entities));
  const have = config && JSON.stringify(watchedOf(config.triggers, 'health|'));
  useEffect(() => {
    const current = announceOf(config);
    if (creds && current?.health && have && have !== want) setAnnounce(creds, current, JSON.parse(want)).catch(() => {});
  }, [creds, config, have, want]);

  const save = (next: Announce) => {
    if (!creds) return;
    setDraft(next);
    setNote(undefined);
    const empty = !next.echoes.length || (!next.cameras.length && !next.health);
    (empty ? (auto ? removeAutomation(creds, ANNOUNCE_ID) : Promise.resolve()) : setAnnounce(creds, next, watched(entities))).catch(
      (e) => setNote(e?.message ?? String(e)),
    );
  };
  const toggle = <T,>(list: T[], item: T, same: (x: T) => boolean) => (list.some(same) ? list.filter((x) => !same(x)) : [...list, item]);

  const test = () =>
    a.echoes.length &&
    call('notify', 'alexa_media', { message: 'This is Smart Home. Announcements are working.', target: a.echoes, data: { type: 'announce' } });

  return (
    <Card>
      <ThemedText type="smallBold">Announcements</ThemedText>

      <ThemedText>On your Echo</ThemedText>
      {!found ? (
        <ThemedText type="small" themeColor="textSecondary">Checking for Alexa…</ThemedText>
      ) : !found.installed ? (
        <>
          <ThemedText type="small" themeColor="textSecondary">
            Echo speakers can announce your doorbell, camera motion and home problems. This needs Alexa Media Player, a free
            community add-on for Home Assistant:{'\n'}1. Download it in HACS, then restart Home Assistant.{'\n'}2. Sign in to
            Amazon below (your email, password and the code Amazon sends).{'\n'}It’s unofficial: Amazon changes can break it
            for a few days until it’s updated.
          </ThemedText>
          <Button title="1. Open Alexa Media Player in HACS" disabled={!creds} onPress={() => creds && Linking.openURL(creds.url + AMP_HACS)} />
          <Button title="2. Sign in to Amazon…" disabled={!conn} onPress={() => setSetup(true)} />
        </>
      ) : !found.echoes.length ? (
        <ThemedText type="small" themeColor="textSecondary">Alexa Media Player is set up but has no Echo devices yet.</ThemedText>
      ) : (
        <>
          <ThemedText type="small" themeColor="textSecondary">Speak on</ThemedText>
          <View style={styles.wrap}>
            {found.echoes.map((e) => (
              <Chip
                key={e.entity_id}
                icon="homepod.fill"
                label={name(e)}
                selected={a.echoes.includes(e.entity_id)}
                onPress={() => save({ ...a, echoes: toggle(a.echoes, e.entity_id, (x) => x === e.entity_id) })}
              />
            ))}
          </View>
          <ThemedText type="small" themeColor="textSecondary">Announce</ThemedText>
          {cameras.map((c) => (
            <Row
              key={c.motion}
              label={c.doorbell ? `${c.name}: someone’s at the door` : `${c.name}: motion`}
              value={a.cameras.some((x) => x.motion === c.motion)}
              onChange={() => save({ ...a, cameras: toggle(a.cameras, c, (x) => x.motion === c.motion) })}
            />
          ))}
          <Row label="Home problems (offline, low battery)" value={a.health} onChange={(health) => save({ ...a, health })} />
          <Row
            label="Quiet hours"
            value={!!a.quiet}
            onChange={(on) => save({ ...a, quiet: on ? { from: '22:00:00', to: '07:00:00' } : undefined })}
          />
          {a.quiet && (
            <View style={styles.times}>
              <Time title="From" at={a.quiet.from} onChange={(from) => save({ ...a, quiet: { ...a.quiet!, from } })} />
              <Time title="Until" at={a.quiet.to} onChange={(to) => save({ ...a, quiet: { ...a.quiet!, to } })} />
            </View>
          )}
          {!a.echoes.length && <ThemedText type="small" themeColor="textSecondary">Pick at least one Echo.</ThemedText>}
          {a.echoes.length > 0 && (a.cameras.length > 0 || a.health) && <Blockers list={blockers(entities, a, auto)} call={call} />}
          <Button title="Test announcement" disabled={!a.echoes.length} onPress={test} />
          <ThemedText type="small" themeColor="textSecondary">
            Doorbell presses come from Blink’s motion check, so the Echo may speak up to a minute after the press.
          </ThemedText>
        </>
      )}
      {note && <ThemedText type="small" style={styles.error}>{note}</ThemedText>}

      <ThemedText style={styles.gap}>On your iPhone</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        Siri can read alerts aloud through AirPods, Beats or CarPlay (iOS never reads them from the phone speaker). In iPhone
        Settings › Notifications › Announce Notifications: turn it on, then turn on Home Assistant (your camera, doorbell and
        health alerts come through it). Doorbell and health alerts are time-sensitive, so they’re read even with Focus on.
      </ThemedText>
      <Button title="Open iPhone Settings" onPress={() => Linking.openURL('App-Prefs:NOTIFICATIONS_ID').catch(() => Linking.openSettings())} />

      {setup && <AddDeviceSheet start={{ handler: 'alexa_media' }} onClose={() => setSetup(false)} />}
    </Card>
  );
}

type Fix = { label: string; run: [domain: string, service: string, data: Record<string, unknown>] };
type Blocker = { text: string; fix?: Fix };

/** Everything that would keep an alert from being spoken right now. */
export function blockers(entities: HassEntities, a: Announce, auto?: HassEntity, now = new Date()): Blocker[] {
  const out: Blocker[] = [];
  if (auto?.state === 'off')
    out.push({ text: 'Announcements are turned off in Home Assistant.', fix: { label: 'Turn on', run: ['automation', 'turn_on', { entity_id: auto.entity_id }] } });
  for (const id of a.echoes) {
    const e = entities[id];
    const dnd = entities[`switch.${id.split('.')[1]}_do_not_disturb`];
    if (unavailable(e) || e.attributes.available === false) out.push({ text: `${e ? name(e) : id} is offline.` });
    else if (dnd?.state === 'on')
      out.push({ text: `${name(e)} has Do Not Disturb on, so it stays silent.`, fix: { label: 'Turn off', run: ['switch', 'turn_off', { entity_id: dnd.entity_id }] } });
  }
  if (a.quiet) {
    const t = now.toTimeString().slice(0, 8);
    const { from, to } = a.quiet;
    if (from < to ? t >= from && t < to : t >= from || t < to) out.push({ text: `Quiet hours: nothing is spoken until ${to.slice(0, 5)}.` });
  }
  if (!a.cameras.length) return out;
  if (blinkSignedOut(entities)) return [...out, { text: SIGN_IN_AGAIN }];
  const alarms = byDomain(entities, 'alarm_control_panel').filter((e) => !unavailable(e));
  const disarmed = alarms.filter((e) => !e.state.startsWith('arm'));
  if (alarms.length && disarmed.length === alarms.length)
    out.push({
      text: 'Cameras are disarmed. Blink only reports motion while armed.',
      fix: { label: 'Arm', run: ['alarm_control_panel', 'alarm_arm_away', { entity_id: disarmed.map((e) => e.entity_id) }] },
    });
  for (const c of a.cameras) {
    const detection = entities[`switch.${c.motion.split('.')[1].replace(/_motion$/, '')}_motion_detection`];
    if (unavailable(entities[c.motion])) out.push({ text: `${c.name} is offline.` });
    else if (detection?.state === 'off')
      out.push({ text: `${c.name}: motion detection is off.`, fix: { label: 'Turn on', run: ['switch', 'turn_on', { entity_id: detection.entity_id }] } });
  }
  return out;
}

function Blockers({ list, call }: { list: Blocker[]; call: ReturnType<typeof useHA>['call'] }) {
  if (!list.length) return <ThemedText type="small" style={styles.ok}>✓ Ready: alerts will be spoken.</ThemedText>;
  return (
    <View style={styles.blockers}>
      <ThemedText type="smallBold" style={styles.warn}>Alerts won’t be spoken right now</ThemedText>
      {list.map((b) => (
        <View key={b.text} style={styles.blocker}>
          <ThemedText type="small" style={[styles.flex, styles.warn]}>{b.text}</ThemedText>
          {b.fix && <Chip label={b.fix.label} onPress={() => call(...b.fix!.run)} />}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  blockers: { gap: Spacing.one },
  blocker: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  flex: { flex: 1 },
  ok: { color: '#30D158' },
  warn: { color: '#FF9F0A' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  times: { flexDirection: 'row', gap: Spacing.three },
  gap: { marginTop: Spacing.two },
  error: { color: '#E5484D' },
});
