import { getServices, type Connection, type HassEntities } from 'home-assistant-js-websocket';
import { useEffect, useState } from 'react';

import { byDomain, parentDevices, players, useHA, type Creds, type Device } from '@/ha';
import { rest } from '@/schedules';

// One-of-a-kind automations with fixed ids, so they're found again by id alone:
//   smarthome_timer_<entity>   one-shot "turn off/on at …", disables itself after firing
//   smarthome_away_<entity>    away mode: random on/off in the evening
//   smarthome_alert_<camera>   phone notification with a snapshot when a camera sees motion (or, with Blink Vision,
//                              only for what was in the clip: someone unknown, a vehicle…, with the analyzed frame)
//   smarthome_doorbelltv_<camera>  doorbell press shows the doorbell's live view on the TV
//   smarthome_night_<alarm>    arm at night, disarm in the morning
//   smarthome_leave_<alarm>    arm when everyone has left home; smarthome_arrive_<alarm> disarms on return
//   smarthome_motionlight_<camera>  camera motion after dark switches lights on for a few minutes
//   smarthome_health           phone alert when a device goes offline or a battery runs low
//   smarthome_announce         Echo announcements (Alexa Media Player) for doorbell, motion and health
//   smarthome_camera_snapshots a new snapshot from every Blink camera at 7 AM and 7 PM
//   smarthome_timelapse        a noon snapshot from every camera saved to /media/timelapse, for the time-lapse
//   smarthome_welcome          Blink Vision sees someone at the door it knows: their light colour and greeting
//   smarthome_halloween        Oct 31 evening: motion at the chosen cameras flickers lights, plays a spooky sound, counts
//   smarthome_halloween_photos   …saves each new picture from those cameras; smarthome_halloween_recap: Nov 1 summary
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
export const doorbellTvId = (camera: string) => `smarthome_doorbelltv_${slug(camera)}`;
export const HEALTH_ID = 'smarthome_health';
export const ANNOUNCE_ID = 'smarthome_announce';
export const SNAPSHOTS_ID = 'smarthome_camera_snapshots';
export const TIMELAPSE_ID = 'smarthome_timelapse';
export const WELCOME_ID = 'smarthome_welcome';
export const HALLOWEEN_ID = 'smarthome_halloween';
export const HALLOWEEN_PHOTOS_ID = 'smarthome_halloween_photos';
export const HALLOWEEN_RECAP_ID = 'smarthome_halloween_recap';

/**
 * Blink Instant Events' "last Blink refresh" sensor; its `state` attribute is "auth_failed" once Blink signs it out.
 * Found by suffix: Home Assistant puts the device's area in front of new entity ids.
 */
export const blinkPoll = (entities: HassEntities) =>
  Object.values(entities).find((e) => e.entity_id.startsWith('sensor.') && e.entity_id.endsWith('blink_instant_events_last_blink_refresh'));
export const blinkSignedOut = (entities: HassEntities) => blinkPoll(entities)?.attributes.state === 'auth_failed';
const BLINK_SIGNED_OUT = 'Blink signed out. Sign in again in Home Assistant';
export const SIGN_IN_AGAIN =
  'Blink signed Home Assistant out, so cameras show as offline. Sign in again: in Home Assistant open Settings › Devices & services › Blink Instant Events › Re-authenticate and enter the code Blink texts you. The cameras come back by themselves.';
/**
 * Blink Instant Events can't reach Blink (network or Blink down): polling is backing off (up to an hour), push is
 * disconnected (up to 30 minutes), or the integration itself is waiting to set up again.
 */
export const blinkUnreachable = (entities: HassEntities) => {
  const poll = blinkPoll(entities);
  const push = Object.values(entities).find(
    (e) => e.entity_id.startsWith('binary_sensor.') && e.entity_id.endsWith('blink_instant_events_push_connection'),
  );
  return !!poll && (poll.attributes.state === 'backoff' || poll.state === 'unavailable' || push?.state === 'off');
};
/** Reload Blink Instant Events now instead of waiting out its backoff; retries polling and push together. */
export async function retryBlink(conn: Connection, creds: Creds) {
  const [entry] = await conn.sendMessagePromise<{ entry_id: string }[]>({
    type: 'config_entries/get',
    domain: 'blink_instant_events',
  });
  if (!entry) throw new Error('Blink Instant Events is not set up in Home Assistant');
  const res = await fetch(`${creds.url}/api/config/config_entries/entry/${entry.entry_id}/reload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${creds.token}` },
  });
  if (!res.ok) throw new Error(`Home Assistant returned ${res.status}`);
}
/** Where to sign Blink in again. */
export const BLINK_REAUTH = '/config/integrations/integration/blink_instant_events';


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

/** What a smart alert can be sent for, from Blink Vision's look at each clip. */
export const SMART_KINDS = [
  ['unknown', 'Someone I don’t know'],
  ['known', 'People I know'],
  ['vehicle', 'Vehicles'],
  ['animal', 'Animals'],
  ['other', 'Anything else'],
] as const;
export type SmartKind = (typeof SMART_KINDS)[number][0];
/** Blink Instant Events' event entity on the camera's device fires `detection` (and `doorbell_press`). */
export type Smart = { device: string; event: string; alertFor: SmartKind[] };

// Which kinds a detection is: someone unknown (an unknown face, or a person whose face wasn't seen), someone known…
const KINDS = `{% set a = trigger.to_state.attributes %}{% set k = [] %}\
{% if a.unknown_faces or ('person' in a.labels and not a.people) %}{% set k = k + ['unknown'] %}{% endif %}\
{% if a.people %}{% set k = k + ['known'] %}{% endif %}\
{% if 'vehicle' in a.labels %}{% set k = k + ['vehicle'] %}{% endif %}\
{% if 'animal' in a.labels %}{% set k = k + ['animal'] %}{% endif %}\
{% if not a.labels %}{% set k = k + ['other'] %}{% endif %}`;

/**
 * Alert to the Home Assistant companion app, with a picture. With a proxy `slug`, its Live view button opens this
 * app straight to live view, and so does tapping it, except a smart alert, which opens the analyzed picture. A doorbell's alert is time-sensitive, so it gets through Focus.
 * - Plain: on every motion, with the camera's snapshot.
 * - `smart`: once Blink Vision has read the clip (~15-40 s), only for the kinds in `alertFor`, saying who or what it
 *   was, with the analyzed frame. A doorbell press still alerts at once; its detection then updates that alert.
 */
export function setAlert(creds: Creds, camera: string, motion: string, name: string, notify: string, slug?: string, doorbell = false, smart?: Smart) {
  const live = slug && `smarthome://cameras?live=${encodeURIComponent(slug)}`;
  // The app's own push (notify.smart_home_app) also puts a Live Activity up when the doorbell rings.
  const activity = (on: boolean | string) => doorbell && notify === 'notify.smart_home_app' && { live_activity: on };
  const notification = (message: string, image: string, url = live, ring: boolean | string = true) => ({
    action: notify,
    data: {
      title: name,
      message,
      data: {
        image,
        group: 'motion',
        tag: alertId(camera),
        ...(live && { url, actions: [{ action: 'URI', title: 'Live view', uri: live }] }),
        ...(doorbell && { push: { 'interruption-level': 'time-sensitive' } }),
        ...activity(ring),
      },
    },
  });
  if (!smart)
    return rest(creds, 'POST', alertId(camera), {
      alias: `${name}: ${doorbell ? 'doorbell' : 'motion'} alert`,
      description: 'Created by the Smart Home app',
      triggers: [{ trigger: 'state', entity_id: motion, to: 'on' }],
      conditions: [],
      actions: [notification(doorbell ? 'Someone’s at the door' : 'Motion detected', `/api/camera_proxy/${camera}`)],
      mode: 'single',
      max_exceeded: 'silent',
    });
  const on = (type: string) => ({ trigger: 'device', domain: 'blink_instant_events', device_id: smart.device, entity_id: smart.event, type, id: type });
  return rest(creds, 'POST', alertId(camera), {
    alias: `${name}: smart alert`,
    description: 'Created by the Smart Home app. Needs the Blink Vision add-on.',
    triggers: [...(doorbell ? [on('doorbell_press')] : []), on('detection')],
    variables: { alert_for: smart.alertFor },
    conditions: [
      {
        condition: 'template',
        value_template: `{% if trigger.id == 'doorbell_press' %}true{% else %}${KINDS}{{ k | select('in', alert_for) | list | count > 0 }}{% endif %}`,
      },
    ],
    actions: [
      notification(
        `{{ "Someone’s at the door" if trigger.id == 'doorbell_press' else trigger.to_state.attributes.summary }}`,
        `{{ '/api/camera_proxy/${camera}' if trigger.id == 'doorbell_press' else trigger.to_state.attributes.image }}`,
        // A press opens live view (they're at the door); a detection opens what Blink Vision saw.
        live &&
          `{{ '${live}' if trigger.id == 'doorbell_press' else 'smarthome://cameras?camera=${encodeURIComponent(slug)}&seen=' ~ (trigger.to_state.attributes.image | urlencode) ~ '&what=' ~ (trigger.to_state.attributes.summary | urlencode) }}`,
        // Only the press: the detection that follows updates the alert, it isn't a second ring.
        `{{ trigger.id == 'doorbell_press' }}`,
      ),
    ],
    mode: 'queued',
    max: 5,
    max_exceeded: 'silent',
  });
}

/** The saved smart-alert kinds, or undefined for a plain motion alert. */
export const smartOf = (config?: Record<string, any>): SmartKind[] | undefined => config?.variables?.alert_for;

/** Doorbell press plays the doorbell's live view on these TVs for a minute (only TVs that are on). */
export const setDoorbellTv = (creds: Creds, camera: string, name: string, device: string, event: string, tvs: string[]) =>
  rest(creds, 'POST', doorbellTvId(camera), {
    alias: `${name}: show on TV when the doorbell rings`,
    description: 'Created by the Smart Home app',
    triggers: [{ trigger: 'device', domain: 'blink_instant_events', device_id: device, entity_id: event, type: 'doorbell_press' }],
    conditions: [],
    actions: tvs.map((tv) => ({ action: 'blink_instant_events.show_on_tv', data: { camera, media_player: tv }, continue_on_error: true })),
    mode: 'single',
    max_exceeded: 'silent',
  });

/** The TVs a doorbell automation shows on. */
export const doorbellTvsOf = (config?: Record<string, any>): string[] =>
  (config?.actions ?? []).map((a: any) => a.data?.media_player).filter(Boolean);

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

/**
 * Press every Blink camera's Refresh snapshot button at 7:00 and 19:00 (each wakes a
 * battery camera for a moment). Found by
 * template when it runs, so a camera added later is included.
 */
export const setSnapshots = (creds: Creds) =>
  rest(creds, 'POST', SNAPSHOTS_ID, {
    alias: 'Camera snapshots at 7 AM and 7 PM',
    description: 'Created by the Smart Home app',
    triggers: [{ trigger: 'time', at: ['07:00:00', '19:00:00'] }],
    conditions: [],
    actions: [
      {
        action: 'button.press',
        target: {
          entity_id:
            "{{ integration_entities('blink_instant_events') | select('match', 'button[.]') | select('search', '_refresh_snapshot$') | list }}",
        },
      },
    ],
    mode: 'single',
  });

/** Where the time-lapse frames go: Home Assistant's local media (/media on Home Assistant OS), one folder per camera. */
export const TIMELAPSE_DIR = 'timelapse';

/**
 * Every day at noon (same light all year), wake each Blink camera for a new snapshot, then save every snapshot
 * camera's picture as /media/timelapse/<camera>/<date>.jpg.
 */
export const setTimelapse = (creds: Creds) =>
  rest(creds, 'POST', TIMELAPSE_ID, {
    alias: 'Camera time-lapse: a picture every day at noon',
    description: 'Created by the Smart Home app. Pictures are in Media › My media › timelapse.',
    triggers: [{ trigger: 'time', at: '12:00:00' }],
    conditions: [],
    actions: [
      {
        action: 'button.press',
        target: {
          entity_id:
            "{{ integration_entities('blink_instant_events') | select('match', 'button[.]') | select('search', '_refresh_snapshot$') | list }}",
        },
        continue_on_error: true,
      },
      { delay: { seconds: 60 } }, // ponytail: fixed wait for the battery cameras to wake and upload
      {
        repeat: {
          for_each: "{{ states.camera | selectattr('attributes.snapshot_of', 'defined') | map(attribute='entity_id') | list }}",
          sequence: [
            {
              action: 'camera.snapshot',
              target: { entity_id: '{{ repeat.item }}' },
              data: { filename: `/media/${TIMELAPSE_DIR}/{{ repeat.item.split('.')[1] }}/{{ now().strftime('%Y-%m-%d') }}.jpg` },
              continue_on_error: true,
            },
          ],
        },
      },
    ],
    mode: 'single',
  });

export type Welcome = {
  people: Record<string, { rgb: [number, number, number]; say: string }>;
  lights: string[];
  echoes: string[];
  darkOnly: boolean; // lights only after dark; the greeting is always spoken
};

/**
 * Blink Vision recognises someone in `w.people` at a doorbell: the lights go to the first one's colour (switches just
 * turn on) and the Echoes say each one's greeting. Once per 10 minutes, so walking in and out doesn't repeat it.
 */
export function setWelcome(creds: Creds, w: Welcome, entities: HassEntities) {
  const doorbells = byDomain(entities, 'event').filter((e) => e.attributes.event_types?.includes('doorbell_press'));
  const colour = w.lights.filter((id) => entities[id]?.attributes.supported_color_modes?.some((m: string) => ['hs', 'rgb', 'rgbw', 'rgbww', 'xy'].includes(m)));
  const plain = w.lights.filter((id) => !colour.includes(id));
  const lights = [
    colour.length && { action: 'light.turn_on', target: { entity_id: colour }, data: { rgb_color: '{{ welcome.people[who[0]].rgb }}', brightness_pct: 100 } },
    plain.length && { action: 'homeassistant.turn_on', target: { entity_id: plain } },
  ].filter(Boolean);
  return rest(creds, 'POST', WELCOME_ID, {
    alias: 'Welcome home',
    description: 'Created by the Smart Home app (Cameras › People). Needs Blink Vision.',
    triggers: doorbells.map((e) => ({ trigger: 'state', entity_id: e.entity_id })),
    variables: { welcome: w },
    conditions: [
      {
        condition: 'template',
        value_template:
          "{% set a = trigger.to_state.attributes %}{{ a.event_type == 'detection' and a.people | default([]) | select('in', welcome.people) | list | count > 0 \
and now().timestamp() - as_timestamp(this.attributes.last_triggered, 0) > 600 }}",
      },
    ],
    actions: [
      { variables: { who: "{{ trigger.to_state.attributes.people | select('in', welcome.people) | list }}" } },
      ...(w.darkOnly && lights.length ? [{ if: [{ condition: 'state', entity_id: 'sun.sun', state: 'below_horizon' }], then: lights }] : lights),
      ...(w.echoes.length
        ? [
            {
              action: 'notify.alexa_media',
              data: { message: "{% for p in who %}{{ welcome.people[p].say }} {% endfor %}", target: w.echoes, data: { type: 'announce' } },
              continue_on_error: true,
            },
          ]
        : []),
    ],
    mode: 'single',
  });
}

export const welcomeOf = (config?: Record<string, any>): Welcome | undefined => config?.variables?.welcome;

// Halloween night is Oct 31, 4–11 PM. The tally (an input_text helper) is "<date>|" and a count per 10 minutes from 4 PM:
// 42 numbers, so it fits the helper's 255 characters, and last year's is ignored by its date.
export const HALLOWEEN_TALLY = 'input_text.halloween_tally';
export const HALLOWEEN_DIR = 'halloween';
const FROM = 16 * 60;
const SLOTS = 42;
const TONIGHT = "{{ now().month == 10 and now().day == 31 and 16 <= now().hour < 23 }}";
// Or any time on the practice day you picked (visits then aren't counted).
const TONIGHT_OR_PRACTICE =
  "{{ (now().month == 10 and now().day == 31 and 16 <= now().hour < 23) or now().strftime('%Y-%m-%d') == (halloween.practice | default('')) }}";
const BUMP = `{% set today = now().strftime('%Y-%m-%d') %}{% set s = states('${HALLOWEEN_TALLY}') %}\
{% set n = s.split('|')[1].split(',') | map('int') | list if s.startswith(today ~ '|') else [0] * ${SLOTS} %}\
{% set i = [[((now().hour * 60 + now().minute) - ${FROM}) // 10, 0] | max, ${SLOTS - 1}] | min %}\
{% set ns = namespace(out=[]) %}{% for v in n %}{% set ns.out = ns.out + [v + (1 if loop.index0 == i else 0)] %}{% endfor %}\
{{ today }}|{{ ns.out | join(',') }}`;
const RECAP = `{% set s = states('${HALLOWEEN_TALLY}') %}{% set day = (now() - timedelta(days=1)).strftime('%Y-%m-%d') %}\
{% set n = s.split('|')[1].split(',') | map('int') | list if s.startswith(day ~ '|') else [] %}{% set total = n | sum %}\
{% if total == 0 %}No trick-or-treaters came by last night.{% else %}{% set m = ${FROM} + 10 * n.index(n | max) %}\
{{ total }} group{{ 's' if total != 1 }} of trick-or-treaters last night, busiest at {{ m // 60 - 12 }}:{{ '%02d' % (m % 60) }} PM.{% endif %}`;

/** Tonight's (or, the morning after, last night's) groups from the tally, and the busiest 10 minutes as "6:40 PM". */
export function tallyOf(state?: string, now = new Date()) {
  const [day, counts] = (state ?? '').split('|');
  if (!counts || day !== `${now.getFullYear()}-10-31`) return { total: 0 };
  const n = counts.split(',').map(Number);
  const total = n.reduce((a, b) => a + b, 0);
  const m = FROM + 10 * n.indexOf(Math.max(...n));
  return { total, busiest: total ? `${Math.floor(m / 60) - 12}:${String(m % 60).padStart(2, '0')} PM` : undefined };
}

export const HALLOWEEN_SOUNDS = [
  ['horror_10', 'Haunted door'],
  ['squeaky_12', 'Creaky door'],
  ['amzn_sfx_wolf_howl_02', 'Wolf howl'],
] as const;
/** The iPad's own sounds (assets/sounds, real recordings), separate from the Echo's Alexa sounds above. */
export const IPAD_SOUNDS = [ // id, label, seconds
  ['creaky_door', 'Creaky door', 5],
  ['heartbeat', 'Heartbeat', 7],
  ['thunder', 'Thunder', 6],
  ['evil_laugh', 'Evil laugh', 3.2],
  ['evil_laugh_2', 'Evil laugh 2', 2.5],
  ['witch_cackle', 'Witch cackle', 1.8],
  ['ghost', 'Ghost', 5],
  ['scream', 'Scream', 3.7],
  ['haunted_choir', 'Haunted choir', 5],
  ['monster_growl', 'Monster growl', 5.2],
  ['monster_snarl', 'Monster snarl', 5.2],
  ['monster_roar', 'Monster roar', 5.2],
  ['monster_breath', 'Monster breath', 5.2],
] as const;
/** The iPad blends each sound into the next over this long (src/components/halloween.tsx). */
export const CROSSFADE = 0.6;
const LINE_SECONDS = 2.5;
/** How long a visit's sounds last (the lights play along); the Echo's are about 8 s. */
export function playSeconds(h: Pick<Halloween, 'ipad' | 'ipadSounds' | 'say'>) {
  if (!h.ipad) return 8;
  const parts = [...(h.ipadSounds ?? IPAD_PLAYLIST).map((id) => IPAD_SOUNDS.find((s) => s[0] === id)?.[2] ?? 0), ...(h.say ? [LINE_SECONDS] : [])];
  return Math.max(4, Math.round(parts.reduce((a, b) => a + b, 0) - CROSSFADE * Math.max(0, parts.length - 1)));
}
/** A Govee light's own Halloween scene. */
const HALLOWEEN_EFFECT = 'Halloween';
/** What the iPad plays, in order, until you pick your own. */
export const IPAD_PLAYLIST = ['creaky_door', 'monster_growl', 'evil_laugh'];
export const HALLOWEEN_EVENT = 'smarthome_halloween';
/** A porch light's usual yellowish white, in kelvin. */
export const WARM_WHITE = 2700;
// Also recorded for the iPad by scripts/make-halloween-sounds.py: rerun it after changing these.
const LINES = ['I… see… you.', 'Come closer…', 'Take one… if you dare.', 'Happy Halloween!'];

export type Halloween = {
  cameras: string[]; // snapshot cameras; their motion sensors start a visit
  lights: string[];
  echo?: string; // Alexa Media Player speaker (the porch one)
  ipad?: boolean; // the iPad by the door plays its own sounds, through whatever speaker is paired with it
  ipadSounds?: string[]; // played one after another, in this order
  practice?: string; // YYYY-MM-DD: camera motion works all that day too, without counting
  sounds: string[];
  say: boolean; // a spoken line after the sound
  notify?: string; // the morning-after recap
};

/** The tally helper, if it isn't there yet (admin only, like the automations). */
export async function ensureTally(conn: Connection, entities: HassEntities) {
  if (entities[HALLOWEEN_TALLY]) return;
  await conn.sendMessagePromise({ type: 'input_text/create', name: 'Halloween tally', max: 255 });
}

/**
 * A visit: count it (only on the night itself; "Try it" just plays), flicker the lights orange and purple and put them
 * back, play a random sound and line on the Echo. Then a minute before the next, so one group on the path counts once
 * and the sounds don't play over and over (pictures are a separate automation and keep coming).
 */
export async function setHalloween(creds: Creds, h: Halloween, entities: HassEntities) {
  h = { ...h, ipadSounds: h.ipadSounds ?? IPAD_PLAYLIST }; // set up before the iPad had its own
  const motions = h.cameras.map((c) => `binary_sensor.${c.split('.')[1]}_motion`).filter((m) => entities[m]);
  // The lights play for as long as the sounds do. A light with its own Halloween scene (Govee) runs that: one command,
  // where a flicker of colours is too many for Govee's cloud. Others flicker. Then the lights that were on go back to
  // warm white (again a little later if the cloud missed it) and the rest off. An error from a light doesn't stop it.
  const secs = playSeconds(h);
  const fx = h.lights.filter((l) => entities[l]?.attributes.effect_list?.includes(HALLOWEEN_EFFECT));
  const plain = h.lights.filter((l) => !fx.includes(l));
  const colour = (rgb: number[]) => ({ action: 'light.turn_on', target: { entity_id: plain }, data: { rgb_color: rgb, brightness_pct: 100 }, continue_on_error: true });
  const warm = (who: string) => ({
    if: [{ condition: 'template', value_template: `{{ ${who} | count > 0 }}` }],
    then: [{ action: 'light.turn_on', target: { entity_id: `{{ ${who} }}` }, data: { color_temp_kelvin: WARM_WHITE }, continue_on_error: true }],
  });
  const lights = h.lights.length && {
    sequence: [
      { variables: { was_on: "{{ halloween.lights | select('is_state', 'on') | list }}", started: '{{ as_timestamp(now()) }}' } },
      ...(fx.length ? [{ action: 'light.turn_on', target: { entity_id: fx }, data: { effect: HALLOWEEN_EFFECT }, continue_on_error: true }] : []),
      plain.length
        ? {
            repeat: {
              while: [{ condition: 'template', value_template: `{{ as_timestamp(now()) - started < ${secs} }}` }],
              sequence: [colour([255, 90, 0]), { delay: { milliseconds: 600 } }, colour([150, 0, 255]), { delay: { milliseconds: 600 } }],
            },
          }
        : { delay: { seconds: secs } },
      warm('was_on'),
      {
        if: [{ condition: 'template', value_template: "{{ halloween.lights | reject('in', was_on) | list | count > 0 }}" }],
        then: [{ action: 'light.turn_off', target: { entity_id: "{{ halloween.lights | reject('in', was_on) | list }}" }, continue_on_error: true }],
      },
      { delay: { seconds: 5 } },
      warm("was_on | reject('is_state_attr', 'color_mode', 'color_temp') | list"),
    ],
  };
  const sound = h.echo && {
    sequence: [
      ...(h.sounds.length
        ? [{ action: 'media_player.play_media', target: { entity_id: h.echo }, data: { media_content_type: 'sound', media_content_id: '{{ halloween.sounds | random }}' } }]
        : []),
      ...(h.say ? [{ delay: { seconds: 3 } }, { action: 'notify.alexa_media', data: { message: `{{ ${JSON.stringify(LINES)} | random }}`, target: [h.echo], data: { type: 'tts' } } }] : []),
    ],
  };
  // The iPad listens for this event (src/components/halloween.tsx) and plays its own copy of the sound and line.
  const ipad = h.ipad && {
    event: HALLOWEEN_EVENT,
    event_data: { sounds: h.ipadSounds, line: h.say ? `{{ range(${LINES.length}) | random }}` : -1 },
  };
  await rest(creds, 'POST', HALLOWEEN_ID, {
    alias: 'Halloween: trick-or-treaters',
    description: 'Created by the Smart Home app. Runs on Oct 31 from 4 to 11 PM (and on a practice day); comes back next year.',
    triggers: [{ trigger: 'state', entity_id: motions, to: 'on' }],
    variables: { halloween: h },
    conditions: [{ condition: 'template', value_template: TONIGHT_OR_PRACTICE }],
    actions: [
      { if: [{ condition: 'template', value_template: TONIGHT }], then: [{ action: 'input_text.set_value', target: { entity_id: HALLOWEEN_TALLY }, data: { value: BUMP } }] },
      ...([lights, sound, ipad].some(Boolean) ? [{ parallel: [lights, sound, ipad].filter(Boolean) }] : []),
      { delay: { seconds: 60 } }, // one visit a minute: no sounds or flicker meanwhile, and two groups that close count once
    ],
    mode: 'single',
    max_exceeded: 'silent',
  });
  await rest(creds, 'POST', HALLOWEEN_PHOTOS_ID, {
    alias: 'Halloween: a picture of each group',
    description: 'Created by the Smart Home app. Pictures are in Media › My media › halloween.',
    triggers: [{ trigger: 'state', entity_id: h.cameras, attribute: 'snapshot_id' }],
    conditions: [{ condition: 'template', value_template: TONIGHT }],
    actions: [
      {
        action: 'camera.snapshot',
        target: { entity_id: '{{ trigger.entity_id }}' },
        data: { filename: `/media/${HALLOWEEN_DIR}/{{ now().strftime('%Y-%m-%d') }}/{{ now().strftime('%H-%M-%S') }}.jpg` },
      },
    ],
    mode: 'parallel',
  });
  if (h.notify)
    await rest(creds, 'POST', HALLOWEEN_RECAP_ID, {
      alias: 'Halloween: the morning-after recap',
      description: 'Created by the Smart Home app',
      triggers: [{ trigger: 'time', at: '09:00:00' }],
      conditions: [{ condition: 'template', value_template: '{{ now().month == 11 and now().day == 1 }}' }],
      actions: [{ action: h.notify, data: { title: 'Halloween', message: RECAP } }],
      mode: 'single',
    });
}

export const removeHalloween = (creds: Creds) =>
  Promise.all([HALLOWEEN_ID, HALLOWEEN_PHOTOS_ID, HALLOWEEN_RECAP_ID].map((id) => removeAutomation(creds, id).catch(() => {})));

export const halloweenOf = (config?: Record<string, any>): Halloween | undefined => config?.variables?.halloween;

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
  climate: string[]; // thermostats: too cold, too hot, or running without the temperature changing
};

// The things people own and would notice going offline (not every helper sensor).
const MAIN = ['light', 'switch', 'fan', 'vacuum', 'camera', 'alarm_control_panel', 'media_player', 'climate', 'cover', 'lock'];

export const binaries = (entities: HassEntities, cls: string) =>
  byDomain(entities, 'binary_sensor').filter((e) => e.attributes.device_class === cls);

/**
 * Devices that count for health, one entity per thing you own: not Blink's motion switches or live-view twins, not
 * settings switches on a speaker/TV/light (Echo Do Not Disturb, Govee music mode), and only the media player the app
 * shows (a TV is also a Cast device; the Alexa phone app isn't a device).
 */
export function mainEntities(entities: HassEntities, devices: Record<string, Device>) {
  const parent = parentDevices(entities, devices);
  const shown = new Set(players(entities, devices).map((e) => e.entity_id));
  return byDomain(entities, ...MAIN).filter(
    (e) =>
      !e.attributes.proxy_slug &&
      !(e.entity_id.startsWith('switch.') && parent.has(devices[e.entity_id]?.id)) &&
      !(e.entity_id.startsWith('media_player.') && !shown.has(e.entity_id)),
  );
}

/** `w` without the entities in `skip`. */
export const without = (w: Watched, skip: string[] = []) =>
  Object.fromEntries(Object.entries(w).map(([k, ids]) => [k, ids.filter((id) => !skip.includes(id))])) as Watched;

/** What health alerts watch, from what's in HA right now. */
export function watched(entities: HassEntities, devices: Record<string, Device>): Watched {
  return {
    offline: mainEntities(entities, devices).map((e) => e.entity_id),
    disconnected: binaries(entities, 'connectivity').map((e) => e.entity_id),
    lowBattery: binaries(entities, 'battery').map((e) => e.entity_id),
    batteryLevel: byDomain(entities, 'sensor')
      .filter((e) => e.attributes.device_class === 'battery')
      .map((e) => e.entity_id),
    blinkAuth: [blinkPoll(entities)?.entity_id ?? []].flat(),
    climate: byDomain(entities, 'climate').map((e) => e.entity_id),
  };
}

// ponytail: limits in °C (a °F thermostat's reading is converted); make them settings if the house runs colder.
const COLD = 16;
const HOT = 28;
const CELSIUS = "{% set t = state.attributes.current_temperature | float(none) %}{{ t if t is none or state.attributes.max_temp < 40 else (t - 32) * 5 / 9 }}";
const STUCK = 'ran 2 hours but the temperature didn’t change';
/** Health triggers' extra check: a thermostat that ran 2 hours alerts only if the temperature moved less than half a degree. */
const RUNNING_CHECK = {
  condition: 'template',
  value_template: `{% if trigger.id.endswith('${STUCK}') %}{% set was = trigger.to_state.attributes.current_temperature | float(0) %}\
{% set cur = state_attr(trigger.entity_id, 'current_temperature') | float(0) %}\
{{ state_attr(trigger.entity_id, 'hvac_action') == trigger.to_state.attributes.hvac_action and (cur - was if trigger.to_state.attributes.hvac_action == 'heating' else was - cur) < 0.5 }}\
{% else %}true{% endif %}`,
};

// Trigger ids are the words after the device name ("Porch light is offline"); `tag` prefixes them.
function healthTriggers(w: Watched, tag = '') {
  const five = '00:05:00';
  return [
    w.offline.length && { trigger: 'state', entity_id: w.offline, to: 'unavailable', for: five, id: `${tag}is offline` },
    w.disconnected.length && { trigger: 'state', entity_id: w.disconnected, to: 'off', for: five, id: `${tag}disconnected` },
    w.lowBattery.length && { trigger: 'state', entity_id: w.lowBattery, to: 'on', id: `${tag}battery is low` },
    w.batteryLevel.length && { trigger: 'numeric_state', entity_id: w.batteryLevel, below: 20, id: `${tag}battery is low` },
    w.blinkAuth.length && { trigger: 'state', entity_id: w.blinkAuth, attribute: 'state', to: 'auth_failed', id: `${tag}blink signed out` },
    w.climate.length && { trigger: 'numeric_state', entity_id: w.climate, value_template: CELSIUS, below: COLD, for: '00:30:00', id: `${tag}is below ${COLD}° inside` },
    w.climate.length && { trigger: 'numeric_state', entity_id: w.climate, value_template: CELSIUS, above: HOT, for: '00:30:00', id: `${tag}is above ${HOT}° inside` },
    // A furnace or AC that runs and runs without warming or cooling the house has likely failed.
    w.climate.length && { trigger: 'state', entity_id: w.climate, attribute: 'hvac_action', to: ['heating', 'cooling'], for: '02:00:00', id: `${tag}${STUCK}` },
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
    climate: ids((t) => t.attribute === 'hvac_action'),
  };
}

/** One automation for every "something needs attention" alert, plus Home Assistant restarts. `skip`: devices muted in their settings. */
export function setHealthAlerts(creds: Creds, notify: string, w: Watched, skip: string[] = []) {
  return rest(creds, 'POST', HEALTH_ID, {
    alias: 'Smart Home: health alerts',
    description: 'Created by the Smart Home app. Re-save it in the app after adding devices.',
    triggers: healthTriggers(without(w, skip)),
    variables: { skip },
    conditions: [RUNNING_CHECK],
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
export const announceable = (entities: HassEntities, devices: Record<string, Device>) => [
  ...announceCameras(entities).map((c) => c.motion),
  ...new Set(Object.values(watched(entities, devices)).flat()),
];

/** Every camera and device is announced unless it's in `a.skip`. */
export const announceTriggers = (a: Announce, entities: HassEntities, devices: Record<string, Device>) => [
  ...announceCameras(entities)
    .filter((c) => !a.skip?.includes(c.motion))
    .map((c) => ({ trigger: 'state', entity_id: c.motion, to: 'on', id: `${c.doorbell ? 'doorbell' : 'motion'}|${c.name}` })),
  ...healthTriggers(without(watched(entities, devices), a.skip), 'health|'),
  // Blink Vision's detection after a doorbell press: say who it is, if it knows them.
  ...byDomain(entities, 'event')
    .filter((e) => e.attributes.event_types?.includes('doorbell_press') && !a.skip?.includes(e.entity_id))
    .map((e) => ({ trigger: 'state', entity_id: e.entity_id, id: 'who|door' })),
];

/** A detection within 2 minutes of a press, with someone Blink Vision knows; anything else isn't a "who". */
const WHO_CHECK = {
  condition: 'template',
  value_template: `{% if trigger.id == 'who|door' %}{% set a = trigger.to_state.attributes %}{% set b = trigger.from_state.attributes %}\
{{ a.event_type == 'detection' and a.people | default([]) | count > 0 and b.event_type == 'doorbell_press' \
and as_timestamp(trigger.to_state.last_changed) - as_timestamp(trigger.from_state.last_changed) < 120 }}\
{% else %}true{% endif %}`,
};

/** Ids and entities of `triggers`: what to compare to see if the automation is out of date. */
export const triggerKey = (triggers: any[] = []) =>
  JSON.stringify(triggers.flatMap((t) => [t.id, ...[t.entity_id ?? []].flat()]).sort());

/** Echo announcements through Alexa Media Player (HACS): doorbell, camera motion and health problems. */
export function setAnnounce(creds: Creds, a: Announce, entities: HassEntities, devices: Record<string, Device>) {
  return rest(creds, 'POST', ANNOUNCE_ID, {
    alias: 'Smart Home: Echo announcements',
    description: 'Created by the Smart Home app (Settings › Announcements, and Announce on Echo in each device). Needs Alexa Media Player.',
    triggers: announceTriggers(a, entities, devices),
    variables: { skip: a.skip ?? [] },
    // A time condition from `to` until `from` wraps past midnight when needed.
    conditions: [...(a.quiet ? [{ condition: 'time', after: a.quiet.to, before: a.quiet.from }] : []), RUNNING_CHECK, WHO_CHECK],
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

const ANNOUNCE_MESSAGE = `{% set k = trigger.id.split('|') %}{% if k[0] == 'doorbell' %}Someone's at the {{ k[1] }}{% elif k[0] == 'who' %}{% set p = trigger.to_state.attributes.people %}{{ p | join(' and ') }} {{ 'is' if p | count == 1 else 'are' }} at the door{% elif k[0] == 'motion' %}Motion at {{ k[1] }}{% elif k[1] == 'restarted' %}Home Assistant restarted{% elif k[1] == 'blink signed out' %}${BLINK_SIGNED_OUT}{% else %}{{ trigger.to_state.name }} {{ k[1] }}{% endif %}`;

export function announceOf(config?: Record<string, any>): Announce | undefined {
  if (!config) return undefined;
  const quiet = config.conditions?.find((c: any) => c.condition === 'time');
  return {
    echoes: [config.actions?.[0]?.data?.target ?? []].flat(),
    quiet: quiet && { from: quiet.before, to: quiet.after },
    skip: config.variables?.skip ?? [],
  };
}

/** The saved announcements, and a save that rebuilds the automation from what's in HA now (none without an Echo). */
export function useAnnounce() {
  const { creds, entities, devices } = useHA();
  const auto = useAutomation(ANNOUNCE_ID);
  const config = useAutomationConfig(ANNOUNCE_ID);
  const save = async (next: Announce) => {
    if (!creds) return;
    if (next.echoes.length) await setAnnounce(creds, next, entities, devices);
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
      // This app's own alerts (homeassistant/custom_components/smarthome_push) first, then the companion app's.
      (all) =>
        setFound(
          Object.keys(all.notify ?? {})
            .filter((s) => s === 'smart_home_app' || s.startsWith('mobile_app_'))
            .sort((a, b) => Number(b === 'smart_home_app') - Number(a === 'smart_home_app'))
            .map((s) => `notify.${s}`),
        ),
      () => {},
    );
  }, [conn]);
  return found;
}
