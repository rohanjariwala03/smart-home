import Slider from '@react-native-community/slider';
import type { HassEntity } from 'home-assistant-js-websocket';
import { useState } from 'react';
import { Button, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { AnnounceRow } from '@/components/announce-settings';
import { Chip } from '@/components/chip';
import { ActivityCard, AwayCard, NameRoomCard, RenameButton, TimerCard } from '@/components/device-extras';
import { ScheduleCard } from '@/components/schedule-card';
import { Card } from '@/components/screen';
import { FavouriteButton } from '@/favourites';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { armStatus, Toggle } from '@/components/toggle';
import { Spacing } from '@/constants/theme';
import { deviceName, name, playerOn, unavailable, useHA, type Device } from '@/ha';
import { GoveeCard } from '@/govee';

const COLOR_MODES = ['hs', 'rgb', 'rgbw', 'rgbww', 'xy'];
export const SWATCHES: [number, number, number][] = [
  [255, 255, 255],
  [255, 147, 41],
  [255, 0, 0],
  [255, 0, 140],
  [160, 32, 240],
  [0, 80, 255],
  [0, 200, 200],
  [0, 200, 80],
];

export const VACUUM_STATE: Record<string, string> = {
  cleaning: 'Cleaning',
  docked: 'Docked',
  idle: 'Idle',
  paused: 'Paused',
  returning: 'Returning to dock',
  error: 'Needs attention',
};

const SWITCHABLE = ['light', 'switch', 'fan', 'input_boolean'];

// HA's VacuumEntityFeature bits.
const PAUSE = 4;
const RETURN_HOME = 16;
const LOCATE = 512;
// media_player features
const PLAY_PAUSE = 1;
const MUTE = 8;
const PREVIOUS = 16;
const NEXT = 32;
const VOLUME_STEP = 1024;

/** Everything about one device: its controls, schedules, and the device's other entities (energy, LED, …). */
export function DeviceSheet({ entity, onClose }: { entity: HassEntity; onClose: () => void }) {
  const { entities, devices, call } = useHA();
  const domain = entity.entity_id.split('.')[0];
  const device = devices[entity.entity_id];
  const others = device
    ? Object.values(entities)
        .filter((e) => e.entity_id !== entity.entity_id && devices[e.entity_id]?.id === device.id)
        .sort((a, b) => name(a).localeCompare(name(b)))
    : [];

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <ThemedView style={styles.flex}>
        <ScrollView contentContainerStyle={styles.sheet}>
          <View style={styles.header}>
            <ThemedText type="subtitle" numberOfLines={1} style={styles.flex}>
              {name(entity)}
            </ThemedText>
            <RenameButton entity={entity} />
            {domain !== 'alarm_control_panel' && <FavouriteButton entityId={entity.entity_id} />}
            <Pressable onPress={onClose} accessibilityRole="button" hitSlop={12}>
              <ThemedText type="linkPrimary">Done</ThemedText>
            </Pressable>
          </View>

          {domain === 'light' ? (
            <LightControls entity={entity} />
          ) : domain === 'vacuum' ? (
            <VacuumControls entity={entity} />
          ) : domain === 'media_player' ? (
            <MediaControls entity={entity} />
          ) : domain === 'alarm_control_panel' ? (
            <Card dim={unavailable(entity)}>
              <Toggle
                entity={entity}
                label="Armed"
                isOn={entity.state.startsWith('arm')}
                status={armStatus}
                onChange={(on) =>
                  call('alarm_control_panel', on ? 'alarm_arm_away' : 'alarm_disarm', { entity_id: entity.entity_id })
                }
              />
            </Card>
          ) : (
            <Card dim={unavailable(entity)}>
              <Toggle entity={entity} label="Power" />
            </Card>
          )}

          {domain === 'light' && <GoveeCard device={device} />}

          {(SWITCHABLE.includes(domain) || domain === 'media_player') && <TimerCard entity={entity} />}

          <ScheduleCard entity={entity} />

          {/kasa|tp-link/i.test(device?.manufacturer ?? '') && (
            <ThemedText type="small" themeColor="textSecondary">
              Schedules made in the Kasa app are stored on the switch itself, and Home Assistant can&apos;t see them
              (it talks to the switch over Matter). Add them here instead, then delete them in the Kasa app so they
              don&apos;t run twice. Schedules here run on your hub and work with Alexa too.
            </ThemedText>
          )}

          {SWITCHABLE.includes(domain) && <AwayCard entity={entity} />}

          {domain !== 'alarm_control_panel' && <ActivityCard entity={entity} />}

          {others.length > 0 && (
            <Card>
              <ThemedText type="smallBold">Device</ThemedText>
              {others.map((e) => (
                <EntityRow key={e.entity_id} entity={e} device={device} />
              ))}
            </Card>
          )}

          <AnnounceRow entity={entity} card />

          <NameRoomCard entity={entity} device={device} />

          {device && (
            <ThemedText type="small" themeColor="textSecondary" style={styles.center}>
              {[device.manufacturer, device.model].filter(Boolean).join(' · ')}
            </ThemedText>
          )}
        </ScrollView>
      </ThemedView>
    </Modal>
  );
}

function LightControls({ entity }: { entity: HassEntity }) {
  const { call } = useHA();
  const a = entity.attributes;
  const modes: string[] = a.supported_color_modes ?? [];
  const on = entity.state === 'on';
  const dimmable = modes.some((m) => m !== 'onoff');
  const colored = modes.some((m) => COLOR_MODES.includes(m));
  const warmth = modes.includes('color_temp');
  const minK: number = a.min_color_temp_kelvin ?? 2000;
  const maxK: number = a.max_color_temp_kelvin ?? 6500;
  const turnOn = (data: object) => call('light', 'turn_on', { entity_id: entity.entity_id, ...data });

  return (
    <>
      <Card dim={unavailable(entity)}>
        <Toggle entity={entity} label="Power" />
      </Card>

      {on && dimmable && (
        <Card>
          <View style={styles.row}>
            <ThemedText>Brightness</ThemedText>
            <ThemedText themeColor="textSecondary">{Math.round((a.brightness ?? 255) / 2.55)}%</ThemedText>
          </View>
          <Slider
            minimumValue={1}
            maximumValue={255}
            step={1}
            value={a.brightness ?? 255}
            onSlidingComplete={(brightness) => turnOn({ brightness })}
          />
        </Card>
      )}

      {on && warmth && (
        <Card>
          <ThemedText>Warmth</ThemedText>
          <Slider
            minimumValue={minK}
            maximumValue={maxK}
            step={50}
            value={a.color_temp_kelvin ?? (minK + maxK) / 2}
            minimumTrackTintColor="#FFB45A"
            maximumTrackTintColor="#CFE3FF"
            onSlidingComplete={(k) => turnOn({ color_temp_kelvin: k })}
          />
        </Card>
      )}

      {on && colored && (
        <Card>
          <ThemedText>Colour</ThemedText>
          <View style={styles.swatches}>
            {SWATCHES.map((rgb) => (
              <Pressable
                key={rgb.join()}
                accessibilityLabel={`Set colour rgb ${rgb.join(' ')}`}
                onPress={() => turnOn({ rgb_color: rgb })}
                style={[styles.swatch, { backgroundColor: `rgb(${rgb.join()})` }]}
              />
            ))}
          </View>
        </Card>
      )}
    </>
  );
}

function VacuumControls({ entity }: { entity: HassEntity }) {
  const { call } = useHA();
  const [rooms, setRooms] = useState<string[]>([]);
  const a = entity.attributes;
  const features: number = a.supported_features ?? 0;
  const cleaning = entity.state === 'cleaning';
  const vac = (service: string, data?: object) => call('vacuum', service, { entity_id: entity.entity_id, ...data });
  const speeds: string[] = a.fan_speed_list ?? [];
  const known: string[] = a.rooms ?? []; // Shark exposes its mapped rooms here

  return (
    <>
      <Card dim={unavailable(entity)}>
        <ThemedText>{VACUUM_STATE[entity.state] ?? entity.state}</ThemedText>
        {entity.state === 'error' && a.last_error_message && (
          <ThemedText type="small" themeColor="textSecondary">
            {a.last_error_message}
          </ThemedText>
        )}
        <View style={styles.wrap}>
          {cleaning && features & PAUSE ? (
            <Chip icon="pause.fill" label="Pause" onPress={() => vac('pause')} />
          ) : (
            <Chip icon="play.fill" label={entity.state === 'paused' ? 'Resume' : 'Start'} onPress={() => vac('start')} />
          )}
          {features & RETURN_HOME ? <Chip icon="house.fill" label="Dock" onPress={() => vac('return_to_base')} /> : null}
          {features & LOCATE ? <Chip icon="speaker.wave.2.fill" label="Find" onPress={() => vac('locate')} /> : null}
        </View>
      </Card>

      {speeds.length > 0 && (
        <Card>
          <ThemedText>Suction</ThemedText>
          <View style={styles.wrap}>
            {speeds.map((s) => (
              <Chip key={s} label={s} selected={a.fan_speed === s} onPress={() => vac('set_fan_speed', { fan_speed: s })} />
            ))}
          </View>
        </Card>
      )}

      {known.length > 0 && (
        <Card>
          <ThemedText>Clean specific rooms</ThemedText>
          <View style={styles.wrap}>
            {known.map((r) => (
              <Chip
                key={r}
                label={r}
                selected={rooms.includes(r)}
                onPress={() => setRooms(rooms.includes(r) ? rooms.filter((x) => x !== r) : [...rooms, r])}
              />
            ))}
          </View>
          <Button
            title={rooms.length ? `Clean ${rooms.length === 1 ? rooms[0] : `${rooms.length} rooms`}` : 'Pick rooms'}
            disabled={!rooms.length}
            onPress={() => call('sharkiq', 'clean_room', { entity_id: entity.entity_id, rooms }).then(() => setRooms([]))}
          />
        </Card>
      )}
    </>
  );
}

function MediaControls({ entity }: { entity: HassEntity }) {
  const { call } = useHA();
  const a = entity.attributes;
  const f: number = a.supported_features ?? 0;
  const on = playerOn(entity);
  const mp = (service: string, data?: object) => call('media_player', service, { entity_id: entity.entity_id, ...data });
  const sources: string[] = a.source_list ?? [];

  return (
    <>
      <Card dim={unavailable(entity)}>
        <Toggle
          entity={entity}
          label="Power"
          isOn={on}
          onChange={(v) => mp(v ? 'turn_on' : 'turn_off')}
          status={(v) => (v ? (a.media_title ?? a.app_name ?? 'On') : 'Off')}
        />
        {on && (
          <View style={styles.wrap}>
            {f & VOLUME_STEP ? <Chip icon="speaker.wave.1.fill" label="Quieter" onPress={() => mp('volume_down')} /> : null}
            {f & VOLUME_STEP ? <Chip icon="speaker.wave.3.fill" label="Louder" onPress={() => mp('volume_up')} /> : null}
            {f & MUTE ? (
              <Chip
                icon="speaker.slash.fill"
                label={a.is_volume_muted ? 'Unmute' : 'Mute'}
                selected={!!a.is_volume_muted}
                onPress={() => mp('volume_mute', { is_volume_muted: !a.is_volume_muted })}
              />
            ) : null}
            {f & PREVIOUS ? <Chip icon="backward.fill" label="Back" onPress={() => mp('media_previous_track')} /> : null}
            {f & PLAY_PAUSE ? (
              <Chip icon={entity.state === 'playing' ? 'pause.fill' : 'play.fill'} label={entity.state === 'playing' ? 'Pause' : 'Play'} onPress={() => mp('media_play_pause')} />
            ) : null}
            {f & NEXT ? <Chip icon="forward.fill" label="Next" onPress={() => mp('media_next_track')} /> : null}
          </View>
        )}
      </Card>

      {on && sources.length > 0 && (
        <Card>
          <ThemedText>Input</ThemedText>
          <View style={styles.wrap}>
            {sources.map((s) => (
              <Chip key={s} label={s} selected={a.source === s} onPress={() => mp('select_source', { source: s })} />
            ))}
          </View>
        </Card>
      )}
    </>
  );
}

/** One of the device's other entities, with the control that fits its domain. */
function EntityRow({ entity, device }: { entity: HassEntity; device?: Device }) {
  const { call } = useHA();
  const domain = entity.entity_id.split('.')[0];
  const a = entity.attributes;
  // "Desk Plug Current consumption" → "Current consumption"
  const prefix = deviceName(device);
  const full = name(entity);
  const label = prefix && full.startsWith(`${prefix} `) ? full.slice(prefix.length + 1) : full;
  const set = (service: string, data: object) => call(domain, service, { entity_id: entity.entity_id, ...data });

  if (['switch', 'light', 'fan', 'input_boolean', 'siren'].includes(domain)) return <Toggle entity={entity} label={label} />;

  if (domain === 'select' && !unavailable(entity))
    return (
      <View style={styles.section}>
        <ThemedText>{label}</ThemedText>
        <View style={styles.wrap}>
          {(a.options as string[]).map((o) => (
            <Chip key={o} label={o} selected={entity.state === o} onPress={() => set('select_option', { option: o })} />
          ))}
        </View>
      </View>
    );

  if (domain === 'number' && !unavailable(entity))
    return (
      <View style={styles.section}>
        <View style={styles.row}>
          <ThemedText>{label}</ThemedText>
          <ThemedText themeColor="textSecondary">{stateText(entity)}</ThemedText>
        </View>
        <Slider
          minimumValue={a.min}
          maximumValue={a.max}
          step={a.step}
          value={Number(entity.state)}
          onSlidingComplete={(v) => set('set_value', { value: v })}
        />
      </View>
    );

  return (
    <View style={styles.row}>
      <ThemedText style={styles.flex}>{label}</ThemedText>
      {domain === 'button' ? (
        <Button title="Press" disabled={unavailable(entity)} onPress={() => set('press', {})} />
      ) : (
        <ThemedText themeColor="textSecondary">{stateText(entity)}</ThemedText>
      )}
    </View>
  );
}

/** An entity's state as people say it: units, Yes/No, dates. */
export function stateText(e: HassEntity) {
  const a = e.attributes;
  if (unavailable(e)) return 'Unavailable';
  if (a.device_class === 'timestamp') return new Date(e.state).toLocaleString();
  if (e.entity_id.startsWith('update.')) return e.state === 'on' ? 'Update available' : 'Up to date';
  if (e.entity_id.startsWith('binary_sensor.')) return e.state === 'on' ? 'Yes' : 'No';
  const n = Number(e.state);
  const v = Number.isFinite(n) && e.state.trim() !== '' ? String(Math.round(n * 100) / 100) : e.state;
  return a.unit_of_measurement ? `${v} ${a.unit_of_measurement}` : v;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { textAlign: 'center' },
  sheet: { padding: Spacing.three, gap: Spacing.three, paddingBottom: Spacing.six },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.two },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: Spacing.two },
  section: { gap: Spacing.two },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  swatches: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.three },
  swatch: { width: 40, height: 40, borderRadius: 20, borderWidth: 1, borderColor: '#8888' },
});
