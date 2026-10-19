import { getServices } from 'home-assistant-js-websocket';
import { useEffect, useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';

import type { HassEntities, HassEntity } from 'home-assistant-js-websocket';

import {
  announceable,
  announceCameras,
  announceOf,
  announceTriggers,
  blinkDelay,
  blinkSignedOut,
  HEALTH_ID,
  setHealthAlerts,
  SIGN_IN_AGAIN,
  triggerKey,
  useAnnounce,
  useAutomation,
  useAutomationConfig,
  watched,
  type Announce,
} from '@/automations';
import { AddDeviceSheet } from '@/components/add-device';
import { Row, Time } from '@/components/camera-automations';
import { Chip } from '@/components/chip';
import { Card, Disclosure } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { byDomain, name, unavailable, useHA } from '@/ha';

// Alexa Media Player (github.com/alandtse/alexa_media_player), installed from HACS.
const AMP_HACS = '/_my_redirect/hacs_repository?owner=alandtse&repository=alexa_media_player&category=integration';
const NONE: Announce = { echoes: [] };

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
  const { creds, conn, entities, devices, call } = useHA();
  const found = useEchoes();
  const { auto, config, saved, save: store } = useAnnounce();
  const [draft, setDraft] = useState<Announce>();
  const [setup, setSetup] = useState(false);
  const [note, setNote] = useState<string>();
  const a = draft ?? saved ?? NONE;

  // Rebuild when cameras or devices are added, removed or renamed.
  const want = triggerKey(announceTriggers(saved ?? NONE, entities, devices));
  const have = config && triggerKey(config.triggers);
  useEffect(() => {
    const current = announceOf(config);
    if (current?.echoes.length && have && have !== want && Object.keys(devices).length) store(current).catch(() => {});
  }, [config, have, want]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = (next: Announce) => {
    setDraft(next);
    setNote(undefined);
    store(next).catch((e) => setNote(e?.message ?? String(e)));
  };
  const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

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
          <View style={styles.wrap}>
            <Chip icon="1.circle" label="Open in HACS" disabled={!creds} onPress={() => creds && Linking.openURL(creds.url + AMP_HACS)} />
            <Chip icon="2.circle" label="Sign in to Amazon" disabled={!conn} onPress={() => setSetup(true)} />
          </View>
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
                onPress={() => save({ ...a, echoes: toggle(a.echoes, e.entity_id) })}
              />
            ))}
          </View>
          <ThemedText type="small" themeColor="textSecondary">
            Every camera’s motion and every device’s problems (offline, low battery) are spoken. To leave one out, turn off
            Announce on Echo in its settings (⚙︎) or on its camera card.
          </ThemedText>
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
          {a.echoes.length > 0 && <Blockers list={blockers(entities, a, auto)} call={call} />}
          <View style={styles.wrap}>
            <Chip icon="speaker.wave.2.fill" label="Test announcement" disabled={!a.echoes.length} onPress={test} />
          </View>
          <ThemedText type="small" themeColor="textSecondary">
            Motion only counts once Blink saves a clip (a Blink subscription, or a USB drive in the Sync Module), and the Echo may speak up to {blinkDelay(entities)} later.
          </ThemedText>
        </>
      )}
      {note && <ThemedText type="small" style={styles.error}>{note}</ThemedText>}

      <Disclosure title="Read alerts aloud on iPhone">
        <ThemedText type="small" themeColor="textSecondary">
        Siri can read alerts aloud through AirPods, Beats or CarPlay (iOS never reads them from the phone speaker). In iPhone
        Settings › Notifications › Announce Notifications: turn it on, then turn on Home Assistant (your camera, doorbell and
        health alerts come through it). Doorbell and health alerts are time-sensitive, so they’re read even with Focus on.
        </ThemedText>
        <View style={styles.wrap}>
          <Chip icon="gear" label="Open iPhone Settings" onPress={() => Linking.openURL('App-Prefs:NOTIFICATIONS_ID').catch(() => Linking.openSettings())} />
        </View>
      </Disclosure>

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
  const cameras = announceCameras(entities).filter((c) => !a.skip?.includes(c.motion));
  if (!cameras.length) return out;
  if (blinkSignedOut(entities)) return [...out, { text: SIGN_IN_AGAIN }];
  const alarms = byDomain(entities, 'alarm_control_panel').filter((e) => !unavailable(e));
  const disarmed = alarms.filter((e) => !e.state.startsWith('arm'));
  if (alarms.length && disarmed.length === alarms.length)
    out.push({
      text: 'Cameras are disarmed. Blink only reports motion while armed.',
      fix: { label: 'Arm', run: ['alarm_control_panel', 'alarm_arm_away', { entity_id: disarmed.map((e) => e.entity_id) }] },
    });
  for (const c of cameras) {
    const detection = entities[`switch.${c.motion.split('.')[1].replace(/_motion$/, '')}_motion_detection`];
    if (unavailable(entities[c.motion])) out.push({ text: `${c.name} is offline.` });
    else if (detection?.state === 'off')
      out.push({ text: `${c.name}: motion detection is off.`, fix: { label: 'Turn on', run: ['switch', 'turn_on', { entity_id: detection.entity_id }] } });
  }
  return out;
}

// `skip` with `ids` added (muted) or taken out.
const muted = (skip: string[], ids: string[], on: boolean) => (on ? skip.filter((id) => !ids.includes(id)) : [...new Set([...skip, ...ids])]);

/**
 * Per device or camera: "Announce on Echo" (its motion and problems; once an Echo is set up) and "Alert my phone"
 * (its problems; while health alerts are on). Both on unless turned off here.
 */
export function AlertRows({ entity, card }: { entity: HassEntity; card?: boolean }) {
  const { creds, entities, devices } = useHA();
  const { saved, save } = useAnnounce();
  const health = useAutomation(HEALTH_ID);
  const healthConfig = useAutomationConfig(HEALTH_ID);
  const [draft, setDraft] = useState<Announce>();
  const [healthDraft, setHealthDraft] = useState<string[]>();
  const device = devices[entity.entity_id];
  const mine = (ids: string[]) => ids.filter((id) => id === entity.entity_id || (device && devices[id]?.id === device.id));

  const a = draft ?? saved;
  const echoIds = mine(announceable(entities, devices));
  const phoneIds = mine([...new Set(Object.values(watched(entities, devices)).flat())]);
  const notify: string | undefined = healthConfig?.actions?.[0]?.action;
  const echo = !!a?.echoes.length && echoIds.length > 0;
  const phone = !!creds && !!health && !!notify && phoneIds.length > 0;
  if (!echo && !phone) return null;

  const skip = a?.skip ?? [];
  const healthSkip: string[] = healthDraft ?? healthConfig?.variables?.skip ?? [];
  const rows = (
    <>
      {echo && (
        <Row
          label="Announce on Echo"
          value={!echoIds.some((id) => skip.includes(id))}
          onChange={(on) => {
            const next = { ...a!, skip: muted(skip, echoIds, on) };
            setDraft(next);
            save(next).catch(() => setDraft(undefined));
          }}
        />
      )}
      {phone && (
        <Row
          label="Alert my phone if it has a problem"
          value={!phoneIds.some((id) => healthSkip.includes(id))}
          onChange={(on) => {
            const next = muted(healthSkip, phoneIds, on);
            setHealthDraft(next);
            setHealthAlerts(creds!, notify!, watched(entities, devices), next).catch(() => setHealthDraft(undefined));
          }}
        />
      )}
    </>
  );
  return card ? <Card>{rows}</Card> : rows;
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
  error: { color: '#E5484D' },
});
