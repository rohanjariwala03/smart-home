import type { HassEntities, HassEntity } from 'home-assistant-js-websocket';
import { router, useLocalSearchParams } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import { Alert, Button, Image, Linking, Pressable, StyleSheet, Switch, Text, View } from 'react-native';

import {
  alertId,
  blinkSignedOut,
  motionLightId,
  restartBlinkProxy,
  SIGN_IN_AGAIN,
  removeAutomation,
  setAlert,
  useAutomation,
  useNotifyServices,
} from '@/automations';
import { ArmingCard, MotionLightCard } from '@/components/camera-automations';
import { Chip } from '@/components/chip';
import { ClipsSheet } from '@/components/clips';
import { DeviceSheet } from '@/components/device-sheet';
import { LiveGrid } from '@/components/live-grid';
import { LiveView } from '@/components/live-view';
import { Card, Disclosure, Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { armStatus, Toggle } from '@/components/toggle';
import { FavouriteButton } from '@/favourites';
import { byDomain, name, unavailable, useHA } from '@/ha';

const BLINK_APP_STORE = 'https://apps.apple.com/app/id1013961111';

// Works with either Blink integration:
// - HA's own Blink integration: camera.<name> (snapshots only), plus a motion-detection switch,
//   motion binary_sensor and battery/temperature on the same device; blink.trigger_camera takes a new snapshot.
// - Blink Live View Proxy (github.com/Teethree89/ha-blink-live-view-proxy), which adds live view:
//   camera.blink_proxy_<slug> (snapshot_of = slug), a live camera with proxy_slug = slug,
//   binary_sensor/button/switch.blink_proxy_<slug>_{motion,refresh_snapshot,motion_detection}.
export default function CamerasScreen() {
  const { conn, creds, entities, devices, call } = useHA();
  const [clips, setClips] = useState<string | true>(); // camera slug, or true for all
  const [grid, setGrid] = useState(false);
  const [detail, setDetail] = useState<string>();
  const notify = useNotifyServices();
  // smarthome://cameras?live=<slug>, from a motion or doorbell alert.
  const { live } = useLocalSearchParams<{ live?: string }>();
  // Proxy live cameras are opened from their snapshot camera's card, not listed on their own.
  const cameras = byDomain(entities, 'camera').filter((e) => !e.attributes.proxy_slug);
  const liveCamera = live ? cameras.find((e) => e.attributes.snapshot_of === live) : undefined;
  const syncs = byDomain(entities, 'alarm_control_panel').filter(
    (e) => e.entity_id.includes('.blink_proxy_') || devices[e.entity_id]?.manufacturer === 'Blink',
  );

  return (
    <Screen
      title="Cameras"
      action={
        cameras.some((e) => e.attributes.snapshot_of) && (
          <View style={styles.chips}>
            <Chip icon="square.grid.2x2.fill" label="Live" onPress={() => setGrid(true)} />
            <Chip icon="film.stack" label="Clips" onPress={() => setClips(true)} />
          </View>
        )
      }>
      {blinkSignedOut(entities) && (
        <Card>
          <ThemedText type="smallBold" style={styles.error}>Blink signed out</ThemedText>
          <ThemedText type="small">{SIGN_IN_AGAIN}</ThemedText>
          {creds && (
            <View style={styles.actions}>
              <Button title="Open in Home Assistant" onPress={() => Linking.openURL(`${creds.url}/blink-liveview-proxy-auth`)} />
              <Button
                title="Reconnect cameras"
                disabled={!conn}
                onPress={() =>
                  conn && restartBlinkProxy(conn).then(
                    () => Alert.alert('Reconnecting', 'The cameras come back in about a minute.'),
                    (e) => Alert.alert('Couldn’t reconnect', e?.message ?? String(e)),
                  )
                }
              />
            </View>
          )}
        </Card>
      )}
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
      {cameras.map((e) => (
        <Camera key={e.entity_id} entity={e} notify={notify[0]} onClips={setClips} />
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
      {detail && entities[detail] && <DeviceSheet entity={entities[detail]} onClose={() => setDetail(undefined)} />}
      {clips && <ClipsSheet camera={clips === true ? undefined : clips} onClose={() => setClips(undefined)} />}
      <Button title="Open Blink app" onPress={() => Linking.openURL(BLINK_APP_STORE)} />
    </Screen>
  );
}

function Camera({ entity, notify, onClips }: {
  entity: HassEntity;
  notify?: string;
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
    temperature && !unavailable(temperature) && `${temperature.state}${temperature.attributes.unit_of_measurement ?? ''}`,
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
        <FavouriteButton entityId={entity.entity_id} />
      </View>
      {creds && picture && (
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
          {motion && <MotionAlerts camera={entity} motion={motion} notify={notify} slug={slug} doorbell={doorbell} />}
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

const styles = StyleSheet.create({
  image: { width: '100%', aspectRatio: 16 / 9, borderRadius: 12, backgroundColor: '#0003' },
  actions: { flexDirection: 'row', justifyContent: 'space-around', flexWrap: 'wrap' },
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
  flex: { flex: 1 },
  syncRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  error: { color: '#E5484D' },
});

const liveEntity = (entities: HassEntities, slug: string) =>
  Object.values(entities).find((e) => e.entity_id.startsWith('camera.') && e.attributes.proxy_slug === slug);

/** Phone notification with a snapshot when this camera sees motion (via the HA companion app). */
function MotionAlerts({ camera, motion, notify, slug, doorbell }: {
  camera: HassEntity;
  motion: HassEntity;
  notify?: string;
  slug?: string;
  doorbell: boolean;
}) {
  const { creds } = useHA();
  const auto = useAutomation(alertId(camera.entity_id));
  const [error, setError] = useState<string>();

  if (!notify)
    return (
      <ThemedText type="small" themeColor="textSecondary">
        Motion alerts need the Home Assistant app on this phone, signed in to your home.
      </ThemedText>
    );

  const toggle = (on: boolean) => {
    if (!creds) return;
    setError(undefined);
    (on ? setAlert(creds, camera.entity_id, motion.entity_id, name(camera), notify, slug, doorbell) : removeAutomation(creds, alertId(camera.entity_id))).catch(
      (e) => setError(e?.message ?? String(e)),
    );
  };

  return (
    <>
      <View style={styles.syncRow}>
        <ThemedText style={styles.flex}>{doorbell ? 'Doorbell alerts' : 'Motion alerts'}</ThemedText>
        <Switch value={auto?.state === 'on'} onValueChange={toggle} />
      </View>
      {error && <ThemedText type="small" style={styles.error}>{error}</ThemedText>}
    </>
  );
}
