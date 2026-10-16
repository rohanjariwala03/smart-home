import { useEffect, useState } from 'react';

import { useHA, type Creds } from '@/ha';
import { ADMIN_ONLY } from '@/setup';

// Schedules are ordinary HA automations with ids starting "smarthome_". They run on the hub
// even when the phone is off, and also show up (and can be edited) in HA's automation editor.

export const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export type Day = (typeof DAYS)[number];

export type When = { at: string } | { sun: 'sunrise' | 'sunset' } | { onFor: number };

export type Schedule = {
  target: string; // entity it controls
  service: string; // e.g. "switch.turn_on"
  when: When; // a time of day, sunrise/sunset, or "after it's been on N minutes" (auto-off)
  days: Day[]; // empty = every day
};

export type SavedSchedule = Schedule & { id: string; automation: string; enabled: boolean };

const PREFIX = 'smarthome_';

export function toConfig(s: Schedule, alias: string) {
  const w = s.when;
  return {
    alias,
    description: 'Created by the Smart Home app',
    triggers: [
      'at' in w ? { trigger: 'time', at: w.at }
      : 'sun' in w ? { trigger: 'sun', event: w.sun }
      : { trigger: 'state', entity_id: s.target, to: 'on', for: { minutes: w.onFor } },
    ],
    conditions: s.days.length && s.days.length < 7 ? [{ condition: 'time', weekday: s.days }] : [],
    actions: [{ action: s.service, target: { entity_id: s.target } }],
    mode: 'single',
  };
}

/** Reads back what toConfig wrote. Anything edited beyond that shape in HA returns null and is left alone. */
export function fromConfig(c: any): Schedule | null {
  const t = c?.triggers?.[0];
  const a = c?.actions?.[0];
  const target = a?.target?.entity_id;
  if (c?.triggers?.length !== 1 || c?.actions?.length !== 1 || typeof target !== 'string' || !a.action) return null;
  const when: When | null =
    t.trigger === 'time' && typeof t.at === 'string' ? { at: t.at }
    : t.trigger === 'sun' && (t.event === 'sunrise' || t.event === 'sunset') ? { sun: t.event }
    : t.trigger === 'state' && t.for?.minutes ? { onFor: t.for.minutes }
    : null;
  return when && { target, service: a.action, when, days: c.conditions?.[0]?.weekday ?? [] };
}

const ACTIONS: Record<string, string> = {
  turn_on: 'On',
  turn_off: 'Off',
  start: 'Start cleaning',
  return_to_base: 'Dock',
  alarm_arm_away: 'Arm',
  alarm_disarm: 'Disarm',
};

export function describe(s: Schedule) {
  const action = ACTIONS[s.service.split('.')[1]] ?? s.service;
  const w = s.when;
  if ('onFor' in w) return { title: `Auto-off after ${duration(w.onFor)}`, days: '' };
  const when = 'sun' in w ? `at ${w.sun}` : `at ${clock(w.at)}`;
  const d = s.days.join();
  const days =
    !s.days.length || s.days.length === 7 ? 'Every day'
    : d === 'mon,tue,wed,thu,fri' ? 'Weekdays'
    : d === 'sat,sun' ? 'Weekends'
    : s.days.map((x) => x[0].toUpperCase() + x.slice(1)).join(', ');
  return { title: `${action} ${when}`, days };
}

export const duration = (min: number) => (min % 60 ? `${min} min` : `${min / 60} h`);

/** "07:30:00" → "7:30 AM" in the phone's locale. */
export function clock(at: string) {
  const [h, m] = at.split(':').map(Number);
  return new Date(2000, 0, 1, h, m).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

/** Create/replace (POST) or delete (DELETE) one automation by id. Needs an admin token. */
export const rest = (creds: Creds, method: string, id: string, body?: object) => configRest(creds, 'automation', method, id, body);

/** Same for HA's other editable configs (scripts, scenes). */
export async function configRest(creds: Creds, kind: 'automation' | 'script', method: string, id: string, body?: object) {
  const res = await fetch(`${creds.url}/api/config/${kind}/config/${id}`, {
    method,
    headers: { Authorization: `Bearer ${creds.token}`, 'Content-Type': 'application/json' },
    body: body && JSON.stringify(body),
  });
  if (res.status === 401) throw new Error(ADMIN_ONLY);
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? `Home Assistant returned ${res.status}`);
}

export const addSchedule = (creds: Creds, s: Schedule, alias: string) =>
  rest(creds, 'POST', `${PREFIX}${Date.now().toString(36)}`, toConfig(s, alias));

export const deleteSchedule = (creds: Creds, id: string) => rest(creds, 'DELETE', id);

/** This app's schedules for one entity. HA adds/removes the automation entities, so the list stays live. */
export function useSchedules(target: string) {
  const { conn, entities } = useHA();
  const [configs, setConfigs] = useState<Record<string, Schedule | null>>({});
  const [error, setError] = useState<string>();
  const mine = Object.values(entities).filter(
    (e) => e.entity_id.startsWith('automation.') && String(e.attributes.id ?? '').startsWith(PREFIX),
  );
  const key = mine.map((e) => e.entity_id).sort().join();

  useEffect(() => {
    if (!conn || !key) return;
    let cancelled = false;
    Promise.allSettled(
      key.split(',').map((entity_id) =>
        conn
          .sendMessagePromise<{ config: unknown }>({ type: 'automation/config', entity_id })
          .then((r) => [entity_id, fromConfig(r.config)] as const),
      ),
    ).then((results) => {
      if (cancelled) return;
      setConfigs(Object.fromEntries(results.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []))));
      const denied = results.some((r) => r.status === 'rejected' && r.reason?.code === 'unauthorized');
      setError(denied ? ADMIN_ONLY : undefined);
    });
    return () => {
      cancelled = true;
    };
  }, [conn, key]);

  const schedules: SavedSchedule[] = mine.flatMap((e) => {
    const s = configs[e.entity_id];
    return s?.target === target ? [{ ...s, id: e.attributes.id, automation: e.entity_id, enabled: e.state === 'on' }] : [];
  });
  return { schedules, error };
}
