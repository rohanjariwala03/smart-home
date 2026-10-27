import type { HassEntities, HassEntity } from 'home-assistant-js-websocket';
import { router, useLocalSearchParams } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import { Alert, Image, Linking, Modal, Pressable, StyleSheet, Switch, Text, View } from 'react-native';

import {
  alertId,
  BLINK_REAUTH,
  blinkPoll,
  blinkSignedOut,
  blinkUnreachable,
  motionLightId,
  SIGN_IN_AGAIN,
  removeAutomation,
  retryBlink,
  setAlert,
  SMART_KINDS,
  smartOf,
  useAutomation,
  useAutomationConfig,
  useNotifyServices,
  type SmartKind,
} from '@/automations';
import { AlertRows } from '@/components/announce-settings';
import { ArmingCard, DoorbellTvCard, MotionLightCard } from '@/components/camera-automations';
import { Chip } from '@/components/chip';
import { ClipsSheet, type Clip } from '@/components/clips';
import { RenameButton } from '@/components/device-extras';
import { DeviceSheet, stateText } from '@/components/device-sheet';
import { LiveGrid } from '@/components/live-grid';
import { LiveView } from '@/components/live-view';
import { PeopleSheet } from '@/components/people-sheet';
import { TimelapseSheet } from '@/components/timelapse';
import { Card, Disclosure, Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { TodayStrip } from '@/components/today-strip';
import { armStatus, Toggle } from '@/components/toggle';
import { FavouriteButton } from '@/favourites';
import { byDomain, name, unavailable, useHA } from '@/ha';
import { usePeople } from '@/vision';

const BLINK_APP_STORE = 'https://apps.apple.com/app/id1013961111';

// Works with either Blink integration:
// - HA's own Blink integration: camera.<name> (snapshots only), plus a motion-detection switch,
//   motion binary_sensor and battery/temperature on the same device; blink.trigger_camera takes a new snapshot.
// - Blink Instant Events (github.com/rohanjariwala03/ha-blink-instant-events), which adds live view and instant
//   motion: camera.<slug> (snapshot_of = slug), a live camera with proxy_slug = slug, and
//   binary_sensor/button/switch.<slug>_{motion,refresh_snapshot,motion_detection} (ids may start with the area).
export default function CamerasScreen() {
  const { creds, entities, devices, call } = useHA();
  const [clips, setClips] = useState<string | true>(); // camera slug, or true for all
  const [clip, setClip] = useState<Clip>(); // opened from Today
  const [peopleOpen, setPeopleOpen] = useState(false);
  const [timelapse, setTimelapse] = useState(false);
  const vision = usePeople().people != null; // Blink Vision is running
  const [grid, setGrid] = useState(false);
  const [detail, setDetail] = useState<string>();
  const notify = useNotifyServices();
  // smarthome://cameras?live=<slug>, from a motion or doorbell alert; ?camera=<slug>&seen=<picture>&what=<summary>
  // from a smart alert: what Blink Vision saw.
  const { live, camera: seenCamera, seen, what } = useLocalSearchParams<{
    live?: string;
    camera?: string;
    seen?: string;
    what?: string;
  }>();
  // Live cameras are opened from their snapshot camera's card, not listed on their own. While a camera is offline
  // Home Assistant drops its attributes (proxy_slug too), so the entity id is checked as well.
  const cameras = byDomain(entities, 'camera').filter((e) => !e.attributes.proxy_slug && !e.entity_id.endsWith('_live_view'));
  const liveCamera = live ? cameras.find((e) => e.attributes.snapshot_of === live) : undefined;
  const syncs = byDomain(entities, 'alarm_control_panel').filter(
    (e) => devices[e.entity_id]?.manufacturer === 'Blink',
  );

  return (
    <Screen
      title="Cameras"
      action={
        cameras.some((e) => e.attributes.snapshot_of) && (
          <View style={styles.chips}>
            <Chip icon="square.grid.2x2.fill" label="Live" onPress={() => setGrid(true)} />
            <Chip icon="film.stack" label="Clips" onPress={() => setClips(true)} />
            <Chip icon="person.2.fill" label="People" onPress={() => setPeopleOpen(true)} />
            <Chip icon="timelapse" label="Time-lapse" onPress={() => setTimelapse(true)} />
          </View>
        )
      }>
      {blinkSignedOut(entities) && (
        <Card>
          <ThemedText type="smallBold" style={styles.error}>Blink signed out</ThemedText>
          <ThemedText type="small">{SIGN_IN_AGAIN}</ThemedText>
          {creds && (
            <View style={styles.actions}>
              <Chip icon="person.badge.key.fill" label="Sign in again" onPress={() => Linking.openURL(creds.url + BLINK_REAUTH)} />
            </View>
          )}
        </Card>
      )}
      {!blinkSignedOut(entities) && blinkUnreachable(entities) && <BlinkRetryCard />}
      {cameras.length === 0 && (
        <ThemedText type="small" themeColor="textSecondary">
          No cameras yet. Add Blink in Settings → Add by brand.
        </ThemedText>
      )}
      {syncs.map((e) => (
        <Card key={e.entity_id} dim={unavailable(e)}>
          <View style={styles.syncRow}>
            <View style={styles.flex}>
              <Toggle
                entity={e}
                label={name(e)}
                // 'arming' counts as on, so the switch doesn't flick back while Blink gets there.
                isOn={e.state.startsWith('arm')}
                status={armStatus}
                onChange={(on) =>
                  call('alarm_control_panel', on ? 'alarm_arm_away' : 'alarm_disarm', { entity_id: e.entity_id })
                }
              />
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Arming schedules"
              hitSlop={10}
              onPress={() => setDetail(e.entity_id)}>
              <SymbolView name="calendar.badge.clock" size={22} tintColor="#8E8E93" />
            </Pressable>
          </View>
          <Disclosure title="Automatic arming">
            <ArmingCard alarm={e} />
          </Disclosure>
        </Card>
      ))}
      <TodayStrip onOpen={setClip} />
      {cameras.map((e) => (
        <Camera key={e.entity_id} entity={e} notify={notify[0]} vision={vision} onClips={setClips} />
      ))}
      {grid && creds && (
        <LiveGrid
          creds={creds}
          cameras={cameras.flatMap((e) => (e.attributes.snapshot_of ? [{ slug: e.attributes.snapshot_of, name: name(e) }] : []))}
          onClose={() => setGrid(false)}
        />
      )}
      {live && creds && (
        <LiveView
          creds={creds}
          slug={live}
          title={liveCamera ? name(liveCamera) : 'Live view'}
          ptt={liveEntity(entities, live)?.attributes.ptt_supported !== false}
          onClose={() => router.setParams({ live: undefined })}
        />
      )}
      {seen && seenCamera && creds && (
        <Modal visible animationType="fade" presentationStyle="pageSheet" onRequestClose={() => router.setParams({ seen: undefined })}>
          <ThemedView style={styles.seen}>
            <ThemedText type="subtitle">{what || 'What the camera saw'}</ThemedText>
            <Image style={styles.seenImage} resizeMode="contain" source={{ uri: creds.url + seen }} />
            <View style={styles.chips}>
              <Chip
                icon="video.fill"
                label="Live view"
                onPress={() => router.setParams({ seen: undefined, camera: undefined, live: seenCamera })}
              />
              <Chip icon="xmark" label="Close" onPress={() => router.setParams({ seen: undefined, camera: undefined })} />
            </View>
          </ThemedView>
        </Modal>
      )}
      {detail && entities[detail] && <DeviceSheet entity={entities[detail]} onClose={() => setDetail(undefined)} />}
      {clips && <ClipsSheet camera={clips === true ? undefined : clips} onClose={() => setClips(undefined)} />}
      {clip && <ClipsSheet initial={clip} onClose={() => setClip(undefined)} />}
      {peopleOpen && <PeopleSheet onClose={() => setPeopleOpen(false)} />}
      {timelapse && <TimelapseSheet onClose={() => setTimelapse(false)} />}
      <View style={styles.chips}>
        <Chip icon="arrow.up.forward.app" label="Open Blink app" onPress={() => Linking.openURL(BLINK_APP_STORE)} />
      </View>
    </Screen>
  );
}

function Camera({ entity, notify, vision, onClips }: {
  entity: HassEntity;
  notify?: string;
  vision: boolean;
  onClips: (slug: string) => void;
}) {
  const { creds, entities, devices, call } = useHA();
  const [bust, setBust] = useState(0);
  const [busy, setBusy] = useState(false);
  const [watching, setWatching] = useState(false);

  const slug: string | undefined = entity.attributes.snapshot_of;
  const objectId = entity.entity_id.split('.')[1];
  const device = devices[entity.entity_id];
  // Other entities on the same physical camera (HA's Blink integration), by domain and device class.
  const sibling = (domain: string, deviceClass?: string) =>
    device &&
    Object.values(entities).find(
      (e) =>
        e.entity_id.startsWith(`${domain}.`) &&
        devices[e.entity_id]?.id === device.id &&
        (!deviceClass || e.attributes.device_class === deviceClass),
    );

  const live = slug ? liveEntity(entities, slug) : undefined;
  // Blink Instant Events' event entity on this camera: instant doorbell presses, and Blink Vision's detections.
  const event = device && Object.keys(entities).find((id) => id.startsWith('event.') && devices[id]?.id === device.id);
  const events = device && event ? { device: device.id, event } : undefined;
  const motion = entities[`binary_sensor.${objectId}_motion`] ?? sibling('binary_sensor', 'motion');
  const refresh = entities[`button.${objectId}_refresh_snapshot`];
  const motionDetection = entities[`switch.${objectId}_motion_detection`] ?? sibling('switch');
  const battery = sibling('binary_sensor', 'battery'); // on = low
  const temperature = sibling('sensor', 'temperature');
  const picture: string | undefined = entity.attributes.entity_picture;
  const isBlink = device?.manufacturer === 'Blink';
  const doorbell = live?.attributes.camera_type === 'doorbell';
  const canWatch = !!creds && !!slug && !unavailable(live);
  const alertsOn = useAutomation(alertId(entity.entity_id))?.state === 'on';
  const lightsOn = !!useAutomation(motionLightId(entity.entity_id));

  const snapshot = async () => {
    setBusy(true);
    if (refresh) await call('button', 'press', { entity_id: refresh.entity_id });
    // Blink takes a few seconds; HA picks the new picture up on its next poll.
    else await call('blink', 'trigger_camera', { entity_id: entity.entity_id });
    setTimeout(() => {
      setBust(Date.now());
      setBusy(false);
    }, refresh ? 0 : 8000);
  };

  const details = [
    motion && !unavailable(motion) && `Motion: ${motion.state === 'on' ? 'detected' : 'clear'}`,
    battery && !unavailable(battery) && `Battery: ${battery.state === 'on' ? 'low' : 'OK'}`,
    temperature && !unavailable(temperature) && stateText(temperature),
  ].filter(Boolean);
  const automations = [
    motionDetection && !unavailable(motionDetection) && (motionDetection.state === 'on' ? 'Detecting' : 'Detection off'),
    alertsOn && 'Alerts',
    lightsOn && 'Lights',
  ].filter(Boolean);

  return (
    <Card dim={unavailable(entity)}>
      <View style={styles.syncRow}>
        <ThemedText type="smallBold" style={styles.flex}>{name(entity)}</ThemedText>
        <RenameButton entity={entity} />
        <FavouriteButton entityId={entity.entity_id} />
      </View>
      {unavailable(entity) ? (
        // Blink can't reach the camera (or Home Assistant can't reach Blink): say so instead of a blank card.
        <View style={[styles.image, styles.offline]} accessible accessibilityLabel={`${name(entity)} is offline`}>
          <SymbolView name="wifi.slash" size={28} tintColor="#fff" />
          <Text style={styles.offlineText}>Camera offline</Text>
          <Text style={styles.offlineHint}>Check its batteries and Wi-Fi in the Blink app.</Text>
        </View>
      ) : creds && picture && (
        // Tap the snapshot to watch live.
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={canWatch ? `Watch ${name(entity)} live` : `${name(entity)} snapshot`}
          disabled={!canWatch}
          onPress={() => setWatching(true)}
          style={({ pressed }) => pressed && styles.pressed}>
          <Image style={styles.image} source={{ uri: `${creds.url}${picture}&t=${bust}` }} />
          {canWatch && (
            <View style={styles.play}>
              <SymbolView name="play.fill" size={22} tintColor="#fff" />
            </View>
          )}
          <Text style={styles.stamp}>{new Date(entity.attributes.snapshot_taken ?? entity.last_updated).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</Text>
        </Pressable>
      )}
      {details.length > 0 && (
        <ThemedText type="small" themeColor="textSecondary">
          {details.join(' · ')}
        </ThemedText>
      )}
      <View style={styles.chips}>
        {slug ? (
          <Chip icon="video.fill" label="Live" disabled={!canWatch} onPress={() => setWatching(true)} />
        ) : (
          // HA's Blink integration has no live stream; the Blink app does.
          <Chip icon="video.fill" label="Live in Blink" onPress={() => Linking.openURL(BLINK_APP_STORE)} />
        )}
        {slug && <Chip icon="film.stack" label="Clips" onPress={() => onClips(slug)} />}
        {(refresh || isBlink) && (
          <Chip
            icon="camera.fill"
            label={busy ? 'Taking…' : 'Snapshot'}
            disabled={busy || unavailable(refresh ?? entity)}
            onPress={snapshot}
          />
        )}
      </View>
      {(motionDetection || motion) && (
        <Disclosure title={doorbell ? 'Doorbell & motion' : 'Motion'} summary={automations.join(' · ') || 'Off'}>
          {motionDetection && <Toggle entity={motionDetection} label="Motion detection" />}
          {motion && (
            <MotionAlerts camera={entity} motion={motion} notify={notify} slug={slug} doorbell={doorbell} events={events} vision={vision} />
          )}
          {doorbell && events && <DoorbellTvCard camera={entity} {...events} />}
          <AlertRows entity={entity} />
          {motion && <MotionLightCard camera={entity} motion={motion} />}
        </Disclosure>
      )}
      {watching && creds && slug && (
        <LiveView
          creds={creds}
          slug={slug}
          title={name(entity)}
          ptt={live?.attributes.ptt_supported !== false}
          onClose={() => setWatching(false)}
        />
      )}
    </Card>
  );
}

/** Home Assistant lost Blink and is waiting to try again; Retry now reloads the integration instead of waiting. */
function BlinkRetryCard() {
  const { conn, creds, entities } = useHA();
  const [busy, setBusy] = useState(false);
  const retry = async () => {
    if (!conn || !creds) return;
    setBusy(true);
    await retryBlink(conn, creds).catch((e) => Alert.alert('Could not retry Blink', e?.message ?? String(e)));
    setBusy(false);
  };
  const wait = Math.round((blinkPoll(entities)?.attributes.interval ?? 0) / 60);

  return (
    <Card>
      <ThemedText type="smallBold" style={styles.error}>Can’t reach Blink</ThemedText>
      <ThemedText type="small">
        Home Assistant lost its connection to Blink{wait > 5 ? ` and tries again every ${wait} minutes` : ''}. Retry now once
        the internet is back.
      </ThemedText>
      <View style={styles.actions}>
        <Chip icon="arrow.clockwise" label={busy ? 'Retrying…' : 'Retry now'} disabled={busy} onPress={retry} />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  image: { width: '100%', aspectRatio: 16 / 9, borderRadius: 12, backgroundColor: '#0003' },
  seen: { flex: 1, padding: 16, paddingTop: 24, gap: 16 },
  seenImage: { width: '100%', aspectRatio: 16 / 9, borderRadius: 12, backgroundColor: '#0003' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pressed: { opacity: 0.8 },
  play: {
    position: 'absolute',
    alignSelf: 'center',
    top: '50%',
    marginTop: -26,
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  stamp: {
    position: 'absolute',
    left: 8,
    bottom: 8,
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    overflow: 'hidden',
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  offline: { alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: '#3A3A3C' },
  offlineText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  offlineHint: { color: 'rgba(255,255,255,0.7)', fontSize: 12 },
  flex: { flex: 1 },
  syncRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  error: { color: '#E5484D' },
});

const liveEntity = (entities: HassEntities, slug: string) =>
  Object.values(entities).find((e) => e.entity_id.startsWith('camera.') && e.attributes.proxy_slug === slug);

/**
 * Phone notification when this camera sees motion (via the HA companion app): on every motion, or, with Blink Vision,
 * only for what was in the clip (someone unknown, a vehicle…) with the frame it judged.
 */
function MotionAlerts({ camera, motion, notify, slug, doorbell, events, vision }: {
  camera: HassEntity;
  motion: HassEntity;
  notify?: string;
  slug?: string;
  doorbell: boolean;
  events?: { device: string; event: string };
  vision: boolean;
}) {
  const { creds } = useHA();
  const auto = useAutomation(alertId(camera.entity_id));
  const saved = smartOf(useAutomationConfig(alertId(camera.entity_id)));
  const [error, setError] = useState<string>();

  if (!notify)
    return (
      <ThemedText type="small" themeColor="textSecondary">
        Motion alerts need the Home Assistant app on this phone, signed in to your home.
      </ThemedText>
    );

  const on = auto?.state === 'on';
  const smart = vision && events;
  // undefined: every motion; else only for these kinds (never empty: dropping the last one goes back to every motion)
  const save = (enabled: boolean, alertFor?: SmartKind[]) => {
    if (!creds) return;
    setError(undefined);
    const kinds = smart && alertFor?.length ? { ...events, alertFor } : undefined;
    (enabled
      ? setAlert(creds, camera.entity_id, motion.entity_id, name(camera), notify, slug, doorbell, kinds)
      : removeAutomation(creds, alertId(camera.entity_id))
    ).catch((e) => setError(e?.message ?? String(e)));
  };
  const toggleKind = (k: SmartKind) =>
    save(true, saved?.includes(k) ? saved.filter((x) => x !== k) : [...(saved ?? []), k]);

  return (
    <>
      <View style={styles.syncRow}>
        <ThemedText style={styles.flex}>{doorbell ? 'Doorbell alerts' : 'Motion alerts'}</ThemedText>
        <Switch value={on} onValueChange={(v) => save(v, smart ? (saved ?? ['unknown']) : undefined)} />
      </View>
      {on && smart && (
        <>
          <ThemedText type="small" themeColor="textSecondary">Alert me for</ThemedText>
          <View style={styles.chips}>
            <Chip label="Every motion" selected={!saved} onPress={() => save(true)} />
            {SMART_KINDS.map(([k, label]) => (
              <Chip key={k} label={label} selected={!!saved?.includes(k)} onPress={() => toggleKind(k)} />
            ))}
          </View>
          <ThemedText type="small" themeColor="textSecondary">
            {saved
              ? `Arrives 15–40 s after the motion, once Blink Vision has looked at the clip, saying who or what it saw.${doorbell ? ' A doorbell press still alerts at once.' : ''}`
              : 'Arrives within seconds of the motion, with the camera’s last snapshot.'}
          </ThemedText>
        </>
      )}
      {on && events && !vision && (
        <ThemedText type="small" themeColor="textSecondary">
          To be alerted only for people you don’t know, set up face recognition: Cameras › People.
        </ThemedText>
      )}
      {error && <ThemedText type="small" style={styles.error}>{error}</ThemedText>}
    </>
  );
}
