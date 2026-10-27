import Slider from '@react-native-community/slider';
import { SymbolView } from 'expo-symbols';
import type { HassEntity } from 'home-assistant-js-websocket';
import { useEffect, useRef, useState } from 'react';
import { ActionSheetIOS, Button, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { climateLook, climateRooms, degrees, HVAC_MODE } from '@/climate';

import { AlertRows } from '@/components/announce-settings';
import { useRemoveDevice } from '@/components/remove-devices';
import { Chip } from '@/components/chip';
import { ActivityCard, AwayCard, FollowCard, NameRoomCard, RenameButton, TimerCard } from '@/components/device-extras';
import { ScheduleCard } from '@/components/schedule-card';
import { Card } from '@/components/screen';
import { FavouriteButton } from '@/favourites';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { armStatus, Toggle } from '@/components/toggle';
import { Spacing } from '@/constants/theme';
import { deviceName, isEcho, name, playerOn, unavailable, useHA, type Device } from '@/ha';
import { GoveeCard } from '@/govee';
import { useTheme } from '@/hooks/use-theme';

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
const VOLUME_SET = 4;
const MUTE = 8;
const PREVIOUS = 16;
const NEXT = 32;
const VOLUME_STEP = 1024;

/** Everything about one device: its controls, schedules, and the device's other entities (energy, LED, …). */
export function DeviceSheet({ entity, onClose }: { entity: HassEntity; onClose: () => void }) {
  const { entities, devices, call } = useHA();
  const domain = entity.entity_id.split('.')[0];
  const removeDevice = useRemoveDevice();
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
          ) : domain === 'climate' ? (
            <ClimateControls entity={entity} />
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

          {/* The Govee integration already brings scenes into Home Assistant; the app's own Govee key is for Matter lights. */}
          {domain === 'light' && !entity.attributes.effect_list?.length && <GoveeCard device={device} />}

          {(SWITCHABLE.includes(domain) || (domain === 'media_player' && !isEcho(entity))) && <TimerCard entity={entity} />}

          {domain !== 'climate' && <ScheduleCard entity={entity} />}

          {(SWITCHABLE.includes(domain) || (domain === 'media_player' && !isEcho(entity))) && <FollowCard entity={entity} />}

          {/kasa|tp-link/i.test(device?.manufacturer ?? '') && (
            <ThemedText type="small" themeColor="textSecondary">
              Schedules made in the Kasa app are stored on the switch itself, and Home Assistant can&apos;t see them
              (it talks to the switch over Matter). Add them here instead, then delete them in the Kasa app so they
              don&apos;t run twice. Schedules here run on your hub and work with Alexa too.
            </ThemedText>
          )}

          {SWITCHABLE.includes(domain) && <AwayCard entity={entity} />}

          {!['alarm_control_panel', 'climate'].includes(domain) && <ActivityCard entity={entity} />}

          {others.length > 0 && (
            <Card>
              <ThemedText type="smallBold">Device</ThemedText>
              {others.map((e) => (
                <EntityRow key={e.entity_id} entity={e} device={device} />
              ))}
            </Card>
          )}

          <AlertRows entity={entity} card />

          <NameRoomCard entity={entity} device={device} />

          {device && (
            <ThemedText type="small" themeColor="textSecondary" style={styles.center}>
              {[device.manufacturer, device.model].filter(Boolean).join(' · ')}
            </ThemedText>
          )}
          {device && (
            <Button title="Remove device" color="#FF453A" onPress={() => removeDevice(device.id, deviceName(device) ?? name(entity), onClose)} />
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
  const a = entity.attributes;
  const features: number = a.supported_features ?? 0;
  const cleaning = entity.state === 'cleaning';
  const vac = (service: string, data?: object) => call('vacuum', service, { entity_id: entity.entity_id, ...data });
  const speeds: string[] = a.fan_speed_list ?? [];

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
    </>
  );
}

function MediaControls({ entity }: { entity: HassEntity }) {
  const { call } = useHA();
  const a = entity.attributes;
  const f: number = a.supported_features ?? 0;
  const echo = isEcho(entity); // a speaker: always on, nothing to power
  const on = echo ? !unavailable(entity) : playerOn(entity);
  const mp = (service: string, data?: object) => call('media_player', service, { entity_id: entity.entity_id, ...data });
  const sources: string[] = a.source_list ?? [];

  return (
    <>
      <Card dim={unavailable(entity)}>
        {echo ? (
          <ThemedText>{unavailable(entity) ? 'Offline' : entity.state === 'playing' ? (a.media_title ?? 'Playing') : 'Idle'}</ThemedText>
        ) : (
          <Toggle
            entity={entity}
            label="Power"
            isOn={on}
            onChange={(v) => mp(v ? 'turn_on' : 'turn_off')}
            status={(v) => (v ? (a.media_title ?? a.app_name ?? 'On') : 'Off')}
          />
        )}
        {on && f & VOLUME_SET && a.volume_level !== undefined ? (
          <View style={styles.section}>
            <ThemedText type="small" themeColor="textSecondary">Volume {Math.round(a.volume_level * 100)}%</ThemedText>
            <Slider value={a.volume_level} onSlidingComplete={(v) => mp('volume_set', { volume_level: Math.round(v * 100) / 100 })} />
          </View>
        ) : null}
        {on && (
          <View style={styles.wrap}>
            {f & VOLUME_STEP && !(f & VOLUME_SET) ? <Chip icon="speaker.wave.1.fill" label="Quieter" onPress={() => mp('volume_down')} /> : null}
            {f & VOLUME_STEP && !(f & VOLUME_SET) ? <Chip icon="speaker.wave.3.fill" label="Louder" onPress={() => mp('volume_up')} /> : null}
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

/**
 * A thermostat: the room's temperature, − / + for the target (sent once you stop tapping), mode and fan, and every
 * room sensor's reading. In Auto it keeps the room between a heat-to and a cool-to temperature.
 */
function ClimateControls({ entity }: { entity: HassEntity }) {
  const { entities, devices, areas, call } = useHA();
  const theme = useTheme();
  const a = entity.attributes;
  const look = climateLook(entity);
  const step: number = a.target_temp_step ?? (a.max_temp > 40 ? 1 : 0.5); // whole degrees in Fahrenheit
  const range = a.temperature == null && a.target_temp_low != null;
  // What you've tapped to, until Home Assistant reports it back.
  const [pending, setPending] = useState<{ temperature?: number; target_temp_low?: number; target_temp_high?: number }>();
  const send = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(send.current), []);
  const shown = { temperature: a.temperature, target_temp_low: a.target_temp_low, target_temp_high: a.target_temp_high, ...pending };
  const nudge = (key: 'temperature' | 'target_temp_low' | 'target_temp_high', by: number) => {
    const next = { ...shown, [key]: Math.min(a.max_temp, Math.max(a.min_temp, Math.round(((shown[key] ?? a.min_temp) + by) / step) * step)) };
    setPending(next);
    clearTimeout(send.current);
    send.current = setTimeout(() => {
      const data = range ? { target_temp_low: next.target_temp_low, target_temp_high: next.target_temp_high } : { temperature: next.temperature };
      call('climate', 'set_temperature', { entity_id: entity.entity_id, ...data }).finally(() => setPending(undefined));
    }, 900);
  };
  const rooms = climateRooms(entity, entities, devices, areas);
  const modes: string[] = a.hvac_modes ?? [];
  const fans: string[] = a.fan_modes ?? [];
  const presets: string[] = a.preset_modes ?? [];
  const target = (key: 'temperature' | 'target_temp_low' | 'target_temp_high', label: string) => (
    <View style={styles.row}>
      <ThemedText style={styles.flex}>{label}</ThemedText>
      <Stepper label={`${label} lower`} icon="minus" onPress={() => nudge(key, -step)} />
      <ThemedText type="subtitle" style={styles.target}>{degrees(shown[key])}</ThemedText>
      <Stepper label={`${label} higher`} icon="plus" onPress={() => nudge(key, step)} />
    </View>
  );

  return (
    <>
      <Card dim={unavailable(entity)}>
        <View style={styles.row}>
          <View>
            <ThemedText style={styles.now}>{degrees(look.current)}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              Inside{a.current_humidity != null ? ` · ${Math.round(a.current_humidity)}% humidity` : ''}
            </ThemedText>
          </View>
          <View style={styles.action}>
            <SymbolView name={look.icon} size={22} tintColor={look.working ? `rgb(${look.rgb.join()})` : theme.textSecondary} />
            <ThemedText type="smallBold" style={look.working && { color: `rgb(${look.rgb.join()})` }}>
              {look.state.split(/ to | · /)[0]}
            </ThemedText>
          </View>
        </View>
        {entity.state !== 'off' && !unavailable(entity) && (
          <View style={styles.section}>
            {range ? (
              <>
                {target('target_temp_low', 'Heat to')}
                {target('target_temp_high', 'Cool to')}
              </>
            ) : (
              target('temperature', entity.state === 'cool' ? 'Cool to' : 'Heat to')
            )}
          </View>
        )}
      </Card>

      {modes.length > 0 && (
        <Card>
          <ThemedText>Mode</ThemedText>
          <View style={styles.wrap}>
            {modes.map((m) => (
              <Chip key={m} label={m === 'heat_cool' && modes.includes('auto') ? 'Heat/Cool' : (HVAC_MODE[m] ?? m)} selected={entity.state === m} onPress={() => call('climate', 'set_hvac_mode', { entity_id: entity.entity_id, hvac_mode: m })} />
            ))}
          </View>
          {fans.length > 0 && (
            <>
              <ThemedText>Fan</ThemedText>
              <View style={styles.wrap}>
                {fans.map((f) => (
                  <Chip key={f} label={words(f)} selected={a.fan_mode === f} onPress={() => call('climate', 'set_fan_mode', { entity_id: entity.entity_id, fan_mode: f })} />
                ))}
              </View>
            </>
          )}
          {presets.length > 0 && (
            <>
              <ThemedText>Preset</ThemedText>
              <View style={styles.wrap}>
                {presets.map((p) => (
                  <Chip key={p} label={words(p)} selected={a.preset_mode === p} onPress={() => call('climate', 'set_preset_mode', { entity_id: entity.entity_id, preset_mode: p })} />
                ))}
              </View>
            </>
          )}
        </Card>
      )}

      {rooms.length > 1 && (
        <Card>
          <ThemedText type="smallBold">Rooms</ThemedText>
          {rooms.map((r) => (
            <View key={r.key} style={styles.row}>
              <ThemedText style={styles.flex}>{r.name}</ThemedText>
              {r.occupied !== undefined && (
                <SymbolView
                  name={r.occupied ? 'person.fill' : 'person'}
                  size={16}
                  tintColor={r.occupied ? '#30D158' : theme.textSecondary}
                  accessibilityLabel={r.occupied ? 'Someone is there' : 'Empty'}
                />
              )}
              <ThemedText themeColor="textSecondary" style={styles.reading}>{degrees(r.temperature)}</ThemedText>
            </View>
          ))}
        </Card>
      )}
    </>
  );
}

/** "on_low" → "On low" */
const words = (s: string) => s[0].toUpperCase() + s.slice(1).replace(/_/g, ' ');

function Stepper({ label, icon, onPress }: { label: string; icon: 'minus' | 'plus'; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={6}
      onPress={onPress}
      style={({ pressed }) => [styles.stepper, { backgroundColor: theme.backgroundSelected }, pressed && { opacity: 0.6 }]}>
      <SymbolView name={icon} size={16} tintColor={theme.text} />
    </Pressable>
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

  // A long list (a Govee light's 240 scenes) opens as a picker instead of a wall of chips.
  if (domain === 'select' && !unavailable(entity) && a.options.length > 8)
    return (
      <View style={styles.row}>
        <ThemedText style={styles.flex}>{label}</ThemedText>
        <Button
          title={a.options.includes(entity.state) ? entity.state : 'Choose…'}
          onPress={() =>
            ActionSheetIOS.showActionSheetWithOptions(
              { title: label, options: [...a.options, 'Cancel'], cancelButtonIndex: a.options.length },
              (i) => i < a.options.length && set('select_option', { option: a.options[i] }),
            )
          }
        />
      </View>
    );

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
  const v = Number.isFinite(n) && e.state.trim() !== '' ? String(a.device_class === 'temperature' ? Math.round(n) : Math.round(n * 100) / 100) : e.state;
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
  now: { fontSize: 44, lineHeight: 50, fontWeight: '300', fontVariant: ['tabular-nums'] },
  action: { alignItems: 'center', gap: 4 },
  target: { minWidth: 72, textAlign: 'center', fontVariant: ['tabular-nums'] },
  stepper: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  reading: { minWidth: 48, textAlign: 'right', fontVariant: ['tabular-nums'] },
});
