import { getServices, type Connection, type HassEntities } from 'home-assistant-js-websocket';
import { useEffect, useState } from 'react';

import { byDomain, useHA, type Creds } from '@/ha';
import { rest } from '@/schedules';
import { ADMIN_ONLY } from '@/setup';

// One-of-a-kind automations with fixed ids, so they're found again by id alone:
//   smarthome_timer_<entity>   one-shot "turn off/on at …", disables itself after firing
//   smarthome_away_<entity>    away mode: random on/off in the evening
//   smarthome_alert_<camera>   phone notification with a snapshot when a camera sees motion
//   smarthome_night_<alarm>    arm at night, disarm in the morning
//   smarthome_leave_<alarm>    arm when everyone has left home; smarthome_arrive_<alarm> disarms on return
//   smarthome_motionlight_<camera>  camera motion after dark switches lights on for a few minutes
//   smarthome_health           phone alert when a device goes offline or a battery runs low
//   smarthome_announce         Echo announcements (Alexa Media Player) for doorbell, motion and health
// Like schedules, they live in Home Assistant and run with the phone off.

const slug = (entity: string) => entity.replace('.', '_');
export const timerId = (entity: string) => `smarthome_timer_${slug(entity)}`;
export const awayId = (entity: string) => `smarthome_away_${slug(entity)}`;
export const alertId = (camera: string) => `smarthome_alert_${slug(camera)}`;
export const nightId = (alarm: string) => `smarthome_night_${slug(alarm)}`;
export const leaveId = (alarm: string) => `smarthome_leave_${slug(alarm)}`;
export const arriveId = (alarm: string) => `smarthome_arrive_${slug(alarm)}`;
export const motionLightId = (camera: string) => `smarthome_motionlight_${slug(camera)}`;
export const followId = (entity: string) => `smarthome_follow_${slug(entity)}`;
export const HEALTH_ID = 'smarthome_health';
export const ANNOUNCE_ID = 'smarthome_announce';

/** The Blink proxy's "last Blink refresh" sensor; its `state` attribute is "auth_failed" once Blink signs it out. */
export const BLINK_POLL = 'sensor.blink_liveview_proxy_last_blink_refresh';
export const blinkSignedOut = (entities: HassEntities) => entities[BLINK_POLL]?.attributes.state === 'auth_failed';
/** How late motion can show up: the proxy only sees a clip on its next Blink refresh. */
export function blinkDelay(entities: HassEntities) {
  const s = Number(entities[BLINK_POLL]?.attributes.interval) || 300;
  return s < 120 ? `${s} seconds` : `${Math.round(s / 60)} minutes`;
}
const BLINK_SIGNED_OUT = 'Blink signed out. Sign in again in Home Assistant';
export const SIGN_IN_AGAIN =
  'Blink signed Home Assistant out, so cameras show as offline. Sign in again: in Home Assistant open Blink Live View Proxy › Authentication › Resuthenticate and enter the code Blink sends. Then tap Reconnect cameras.';

// After a failed refresh the proxy waits up to an hour before trying Blink again, even after a new
// sign-in; restarting the add-on (it keeps the saved sign-in) makes it reconnect now. Admin token.
export const restartBlinkProxy = (conn: Connection) =>
  conn
    .sendMessagePromise({ type: 'supervisor/api', endpoint: '/addons/a54c2c78_blink_liveview_proxy/restart', method: 'post', timeout: null })
    .catch((e) => {
      throw new Error(e?.code === 'unauthorized' ? ADMIN_ONLY : (e?.message ?? 'Couldn’t restart the Blink proxy'));
    });


/** The automation entity with this config id, if HA has it. */
export function useAutomation(id: string) {
  const { entities } = useHA();
  return Object.values(entities).find((e) => e.entity_id.startsWith('automation.') && e.attributes.id === id);
}

export const removeAutomation = (creds: Creds, id: string) => rest(creds, 'DELETE', id);

/** The saved config of this app's automation `id` (to show its settings), re-read when HA reloads it. */
export function useAutomationConfig<T = Record<string, any>>(id: string) {
  const { conn } = useHA();
  const auto = useAutomation(id);
  const [config, setConfig] = useState<T>();
  const entity = auto?.entity_id;
  const changed = auto?.last_updated;
  useEffect(() => {
    if (!conn || !entity) return;
    conn.sendMessagePromise<{ config: T }>({ type: 'automation/config', entity_id: entity }).then((r) => setConfig(r.config), () => {});
  }, [conn, entity, changed]);
  return entity ? config : undefined;
}

const pad = (n: number) => String(n).padStart(2, '0');

// The end time rides in the alias, so the app can show a countdown without reading the config.
const UNTIL = / until (\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)$/;
export const timerEnd = (alias?: string) => {
  const m = alias?.match(UNTIL);
  return m ? new Date(m[1]) : undefined;
};

/** "Turn <entity> off (or on) at `until`". Fires once: a date condition, then it switches itself off. */
export function setTimer(creds: Creds, entity: string, name: string, on: boolean, until: Date) {
  const domain = entity.split('.')[0];
  const local = `${until.getFullYear()}-${pad(until.getMonth() + 1)}-${pad(until.getDate())}`;
  const at = `${pad(until.getHours())}:${pad(until.getMinutes())}:${pad(until.getSeconds())}`;
  return rest(creds, 'POST', timerId(entity), {
    alias: `${name}: timer ${on ? 'on' : 'off'} until ${local}T${at}`,
    description: 'Created by the Smart Home app',
    triggers: [{ trigger: 'time', at }],
    conditions: [{ condition: 'template', value_template: `{{ now().strftime('%Y-%m-%d') == '${local}' }}` }],
    actions: [
      { action: `${domain}.turn_${on ? 'on' : 'off'}`, target: { entity_id: entity } },
      { action: 'automation.turn_off', target: { entity_id: '{{ this.entity_id }}' } },
    ],
    mode: 'single',
  });
}

/** Away mode: every 20–40 minutes between sunset and 11:30 PM, randomly on or off; off at 11:30 PM. */
export function setAway(creds: Creds, entity: string, name: string) {
  const domain = entity.split('.')[0];
  return rest(creds, 'POST', awayId(entity), {
    alias: `${name}: away mode`,
    description: 'Created by the Smart Home app. Makes the home look lived in.',
    triggers: [
      { trigger: 'time_pattern', minutes: '/20', id: 'tick' },
      { trigger: 'time', at: '23:30:00', id: 'end' },
    ],
    conditions: [],
    actions: [
      {
        choose: [
          {
            conditions: [{ condition: 'trigger', id: 'end' }],
            sequence: [{ action: `${domain}.turn_off`, target: { entity_id: entity } }],
          },
          {
            conditions: [
              { condition: 'sun', after: 'sunset' },
              { condition: 'time', before: '23:30:00' },
              { condition: 'template', value_template: '{{ range(3) | random > 0 }}' },
            ],
            sequence: [
              { action: `{{ ['${domain}.turn_on', '${domain}.turn_off'] | random }}`, target: { entity_id: entity } },
            ],
          },
        ],
      },
    ],
    mode: 'single',
  });
}

/**
 * Motion alert to the Home Assistant companion app, with the camera's snapshot attached.
 * With a proxy `slug`, tapping it (or its Live view button) opens this app straight to live view.
 * Blink doesn't report doorbell presses, so a doorbell's alert is its motion (a press records a
 * clip), sent as time-sensitive so it gets through Focus.
 */
export function setAlert(creds: Creds, camera: string, motion: string, name: string, notify: string, slug?: string, doorbell = false) {
  const live = slug && `smarthome://cameras?live=${encodeURIComponent(slug)}`;
  return rest(creds, 'POST', alertId(camera), {
    alias: `${name}: ${doorbell ? 'doorbell' : 'motion'} alert`,
    description: 'Created by the Smart Home app',
    triggers: [{ trigger: 'state', entity_id: motion, to: 'on' }],
    conditions: [],
    actions: [
      {
        action: notify,
        data: {
          title: name,
          message: doorbell ? 'Someone’s at the door' : 'Motion detected',
          data: {
            image: `/api/camera_proxy/${camera}`,
            group: 'motion',
            tag: alertId(camera),
            ...(live && { url: live, actions: [{ action: 'URI', title: 'Live view', uri: live }] }),
            ...(doorbell && { push: { 'interruption-level': 'time-sensitive' } }),
          },
        },
      },
    ],
    mode: 'single',
    max_exceeded: 'silent',
  });
}

/** Arm the Blink system at `arm` every night and disarm it at `disarm` ("HH:MM:SS"). */
export function setNight(creds: Creds, alarm: string, name: string, arm: string, disarm: string) {
  return rest(creds, 'POST', nightId(alarm), {
    alias: `${name}: night arming`,
    description: 'Created by the Smart Home app',
    triggers: [
      { trigger: 'time', at: arm, id: 'arm' },
      { trigger: 'time', at: disarm, id: 'disarm' },
    ],
    conditions: [],
    actions: [{ action: "alarm_control_panel.alarm_{{ 'arm_away' if trigger.id == 'arm' else 'disarm' }}", target: { entity_id: alarm } }],
    mode: 'single',
  });
}

// zone.home's state is how many people (HA person entities with a phone tracking them) are home.
/** Arm once nobody has been home for 5 minutes. */
export const setLeaveArm = (creds: Creds, alarm: string, name: string) =>
  rest(creds, 'POST', leaveId(alarm), {
    alias: `${name}: arm when everyone leaves`,
    description: 'Created by the Smart Home app',
    triggers: [{ trigger: 'state', entity_id: 'zone.home', to: '0', for: '00:05:00' }],
    conditions: [],
    actions: [{ action: 'alarm_control_panel.alarm_arm_away', target: { entity_id: alarm } }],
    mode: 'single',
  });

/** Disarm when the first person gets home. */
export const setArriveDisarm = (creds: Creds, alarm: string, name: string) =>
  rest(creds, 'POST', arriveId(alarm), {
    alias: `${name}: disarm when someone's home`,
    description: 'Created by the Smart Home app',
    triggers: [{ trigger: 'state', entity_id: 'zone.home', from: '0' }],
    conditions: [{ condition: 'template', value_template: '{{ trigger.to_state.state | int(0) > 0 }}' }],
    actions: [{ action: 'alarm_control_panel.alarm_disarm', target: { entity_id: alarm } }],
    mode: 'single',
  });

export type MotionLight = { lights: string[]; minutes: number; darkOnly: boolean };

/**
 * Motion on a camera switches `lights` on, then off after `minutes`. More motion restarts the countdown.
 * Blink motion arrives on the proxy's next poll, so the lights come on that much later.
 */
// ponytail: also switches off lights that were already on; snapshot their state first if that annoys.
export function setMotionLight(creds: Creds, camera: string, motion: string, name: string, m: MotionLight) {
  return rest(creds, 'POST', motionLightId(camera), {
    alias: `${name}: motion light`,
    description: 'Created by the Smart Home app',
    triggers: [{ trigger: 'state', entity_id: motion, to: 'on' }],
    conditions: m.darkOnly ? [{ condition: 'state', entity_id: 'sun.sun', state: 'below_horizon' }] : [],
    actions: [
      { action: 'homeassistant.turn_on', target: { entity_id: m.lights } },
      { delay: { minutes: m.minutes } },
      { action: 'homeassistant.turn_off', target: { entity_id: m.lights } },
    ],
    mode: 'restart',
  });
}

export type Follow = { targets: string[]; off: boolean; darkOnly: boolean };
const OFF = ['off', 'standby', 'unavailable', 'unknown'];

/**
 * When `entity` turns on (a TV waking counts), switch `targets` on; with `off`, off again when it goes off. A TV that
 * drops off the network when it's off (Cast) counts as off after a minute. `darkOnly` only holds back the switching on.
 */
export function setFollow(creds: Creds, entity: string, name: string, f: Follow) {
  return rest(creds, 'POST', followId(entity), {
    alias: `${name}: turns other devices on`,
    description: 'Created by the Smart Home app',
    triggers: [
      { trigger: 'state', entity_id: entity, from: OFF, not_to: OFF, id: 'on' },
      ...(f.off
        ? [
            { trigger: 'state', entity_id: entity, to: ['off', 'standby'], id: 'off' },
            { trigger: 'state', entity_id: entity, to: 'unavailable', for: { minutes: 1 }, id: 'off' },
          ]
        : []),
    ],
    conditions: f.darkOnly
      ? [{ condition: 'or', conditions: [{ condition: 'trigger', id: 'off' }, { condition: 'state', entity_id: 'sun.sun', state: 'below_horizon' }] }]
      : [],
    actions: [{ action: 'homeassistant.turn_{{ trigger.id }}', target: { entity_id: f.targets } }],
    mode: 'queued',
  });
}

export const followOf = (config?: Record<string, any>): Follow | undefined =>
  config && {
    targets: [config.actions?.[0]?.target?.entity_id ?? []].flat(),
    off: (config.triggers ?? []).length > 1,
    darkOnly: (config.conditions ?? []).length > 0,
  };

export const motionLightOf = (config?: Record<string, any>): MotionLight | undefined =>
  config && {
    lights: [config.actions?.[0]?.target?.entity_id ?? []].flat(),
    minutes: config.actions?.[1]?.delay?.minutes ?? 5,
    darkOnly: (config.conditions ?? []).length > 0,
  };

export type Watched = {
  offline: string[]; // devices' main entities: alert when unavailable for 5 minutes
  disconnected: string[]; // connectivity sensors (Blink proxy, sync modules): alert when off for 5 minutes
  lowBattery: string[]; // battery binary sensors: alert when on
  batteryLevel: string[]; // battery % sensors: alert below 20
  blinkAuth: string[]; // the Blink proxy's poll sensor: alert when Blink signs it out
};

// The things people own and would notice going offline (not every helper sensor).
const MAIN = ['light', 'switch', 'fan', 'vacuum', 'camera', 'alarm_control_panel', 'media_player', 'climate', 'cover', 'lock'];

export const binaries = (entities: HassEntities, cls: string) =>
  byDomain(entities, 'binary_sensor').filter((e) => e.attributes.device_class === cls);

/** Devices that count for health: Blink's motion switches and live-view twins are parts of a camera. */
export const mainEntities = (entities: HassEntities) =>
  byDomain(entities, ...MAIN).filter((e) => !e.entity_id.startsWith('switch.blink_proxy_') && !e.attributes.proxy_slug);

/** `w` without the entities in `skip`. */
export const without = (w: Watched, skip: string[] = []) =>
  Object.fromEntries(Object.entries(w).map(([k, ids]) => [k, ids.filter((id) => !skip.includes(id))])) as Watched;

/** What health alerts watch, from what's in HA right now. */
export function watched(entities: HassEntities): Watched {
  return {
    offline: mainEntities(entities).map((e) => e.entity_id),
    disconnected: binaries(entities, 'connectivity').map((e) => e.entity_id),
    lowBattery: binaries(entities, 'battery').map((e) => e.entity_id),
    batteryLevel: byDomain(entities, 'sensor')
      .filter((e) => e.attributes.device_class === 'battery')
      .map((e) => e.entity_id),
    blinkAuth: entities[BLINK_POLL] ? [BLINK_POLL] : [],
  };
}

// Trigger ids are the words after the device name ("Porch light is offline"); `tag` prefixes them.
function healthTriggers(w: Watched, tag = '') {
  const five = '00:05:00';
  return [
    w.offline.length && { trigger: 'state', entity_id: w.offline, to: 'unavailable', for: five, id: `${tag}is offline` },
    w.disconnected.length && { trigger: 'state', entity_id: w.disconnected, to: 'off', for: five, id: `${tag}disconnected` },
    w.lowBattery.length && { trigger: 'state', entity_id: w.lowBattery, to: 'on', id: `${tag}battery is low` },
    w.batteryLevel.length && { trigger: 'numeric_state', entity_id: w.batteryLevel, below: 20, id: `${tag}battery is low` },
    w.blinkAuth.length && { trigger: 'state', entity_id: w.blinkAuth, attribute: 'state', to: 'auth_failed', id: `${tag}blink signed out` },
    { trigger: 'homeassistant', event: 'start', id: `${tag}restarted` },
  ].filter(Boolean);
}

/** Reads back the watch list healthTriggers wrote, to spot devices added or removed since. */
export function watchedOf(triggers: any[] = [], tag = ''): Watched {
  const ids = (match: (t: any) => boolean) => [triggers.find(match)?.entity_id ?? []].flat();
  return {
    offline: ids((t) => t.id === `${tag}is offline`),
    disconnected: ids((t) => t.id === `${tag}disconnected`),
    lowBattery: ids((t) => t.trigger === 'state' && t.id === `${tag}battery is low`),
    batteryLevel: ids((t) => t.trigger === 'numeric_state' && t.id === `${tag}battery is low`),
    blinkAuth: ids((t) => t.id === `${tag}blink signed out`),
  };
}

/** One automation for every "something needs attention" alert, plus Home Assistant restarts. `skip`: devices muted in their settings. */
export function setHealthAlerts(creds: Creds, notify: string, w: Watched, skip: string[] = []) {
  return rest(creds, 'POST', HEALTH_ID, {
    alias: 'Smart Home: health alerts',
    description: 'Created by the Smart Home app. Re-save it in the app after adding devices.',
    triggers: healthTriggers(without(w, skip)),
    variables: { skip },
    conditions: [],
    actions: [
      {
        action: notify,
        data: {
          title: 'Home health',
          message:
            `{{ 'Home Assistant restarted' if trigger.id == 'restarted' else '${BLINK_SIGNED_OUT}' if trigger.id == 'blink signed out' else trigger.to_state.name ~ ' ' ~ trigger.id }}`,
          // Time-sensitive: gets through Focus, and Siri reads it on AirPods/CarPlay with Announce Notifications.
          data: { group: 'health', url: 'smarthome://status', push: { 'interruption-level': 'time-sensitive' } },
        },
      },
    ],
    mode: 'queued',
  });
}

export type AnnounceCamera = { motion: string; name: string; doorbell: boolean };
export type Announce = {
  echoes: string[]; // Alexa Media Player media_player entities
  quiet?: { from: string; to: string }; // "HH:MM:SS"; nothing is spoken from `from` until `to`
  skip?: string[]; // entities turned off in their device's settings (kept in the automation's variables)
};

/** Cameras with motion (the proxy's snapshot cameras); the doorbell first. */
export const announceCameras = (entities: HassEntities): AnnounceCamera[] =>
  byDomain(entities, 'camera')
    .filter((e) => e.attributes.snapshot_of && entities[`binary_sensor.${e.entity_id.split('.')[1]}_motion`])
    .map((e) => ({
      motion: `binary_sensor.${e.entity_id.split('.')[1]}_motion`,
      name: e.attributes.friendly_name ?? e.entity_id,
      doorbell: Object.values(entities).some(
        (l) => l.attributes.proxy_slug === e.attributes.snapshot_of && l.attributes.camera_type === 'doorbell',
      ),
    }))
    .sort((x, y) => Number(y.doorbell) - Number(x.doorbell));

/** Everything that can be announced: camera motion, then each device's problems. */
export const announceable = (entities: HassEntities) => [
  ...announceCameras(entities).map((c) => c.motion),
  ...new Set(Object.values(watched(entities)).flat()),
];

/** Every camera and device is announced unless it's in `a.skip`. */
export const announceTriggers = (a: Announce, entities: HassEntities) => [
  ...announceCameras(entities)
    .filter((c) => !a.skip?.includes(c.motion))
    .map((c) => ({ trigger: 'state', entity_id: c.motion, to: 'on', id: `${c.doorbell ? 'doorbell' : 'motion'}|${c.name}` })),
  ...healthTriggers(without(watched(entities), a.skip), 'health|'),
];

/** Ids and entities of `triggers`: what to compare to see if the automation is out of date. */
export const triggerKey = (triggers: any[] = []) =>
  JSON.stringify(triggers.flatMap((t) => [t.id, ...[t.entity_id ?? []].flat()]).sort());

/** Echo announcements through Alexa Media Player (HACS): doorbell, camera motion and health problems. */
export function setAnnounce(creds: Creds, a: Announce, entities: HassEntities) {
  return rest(creds, 'POST', ANNOUNCE_ID, {
    alias: 'Smart Home: Echo announcements',
    description: 'Created by the Smart Home app (Settings › Announcements, and Announce on Echo in each device). Needs Alexa Media Player.',
    triggers: announceTriggers(a, entities),
    variables: { skip: a.skip ?? [] },
    // A time condition from `to` until `from` wraps past midnight when needed.
    conditions: a.quiet ? [{ condition: 'time', after: a.quiet.to, before: a.quiet.from }] : [],
    actions: [
      {
        action: 'notify.alexa_media',
        data: {
          message: ANNOUNCE_MESSAGE,
          target: a.echoes,
          data: { type: 'announce' },
        },
      },
    ],
    mode: 'queued',
    max: 5,
    max_exceeded: 'silent',
  });
}

const ANNOUNCE_MESSAGE = `{% set k = trigger.id.split('|') %}{% if k[0] == 'doorbell' %}Someone's at the {{ k[1] }}{% elif k[0] == 'motion' %}Motion at {{ k[1] }}{% elif k[1] == 'restarted' %}Home Assistant restarted{% elif k[1] == 'blink signed out' %}${BLINK_SIGNED_OUT}{% else %}{{ trigger.to_state.name }} {{ k[1] }}{% endif %}`;

export function announceOf(config?: Record<string, any>): Announce | undefined {
  if (!config) return undefined;
  const quiet = config.conditions?.[0];
  return {
    echoes: [config.actions?.[0]?.data?.target ?? []].flat(),
    quiet: quiet && { from: quiet.before, to: quiet.after },
    skip: config.variables?.skip ?? [],
  };
}

/** The saved announcements, and a save that rebuilds the automation from what's in HA now (none without an Echo). */
export function useAnnounce() {
  const { creds, entities } = useHA();
  const auto = useAutomation(ANNOUNCE_ID);
  const config = useAutomationConfig(ANNOUNCE_ID);
  const save = async (next: Announce) => {
    if (!creds) return;
    if (next.echoes.length) await setAnnounce(creds, next, entities);
    else if (auto) await removeAutomation(creds, ANNOUNCE_ID);
  };
  return { auto, config, saved: announceOf(config), save };
}

/** The phone's notify actions from the HA companion app (notify.mobile_app_<phone>), if it's installed. */
export function useNotifyServices() {
  const { conn } = useHA();
  const [found, setFound] = useState<string[]>([]);
  useEffect(() => {
    if (!conn) return;
    getServices(conn).then(
      (all) => setFound(Object.keys(all.notify ?? {}).filter((s) => s.startsWith('mobile_app_')).map((s) => `notify.${s}`)),
      () => {},
    );
  }, [conn]);
  return found;
}
