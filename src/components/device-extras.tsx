import type { HassEntity } from 'home-assistant-js-websocket';
import { useEffect, useState } from 'react';
import { Button, StyleSheet, Switch, TextInput, View } from 'react-native';

import { Chip } from '@/components/chip';
import { Card } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { awayId, removeAutomation, setAway, setTimer, timerEnd, timerId, useAutomation } from '@/automations';
import { name, useHA, type Device } from '@/ha';
import { useTheme } from '@/hooks/use-theme';
import { ADMIN_ONLY } from '@/setup';

const TIMERS = [15, 30, 60, 120, 240, 480];
const RED = '#E5484D';

const label = (min: number) => (min < 60 ? `${min} min` : `${min / 60} h`);

/** When a timer is running for this entity, the time it fires. */
export function useTimer(entity: string) {
  const auto = useAutomation(timerId(entity));
  const end = auto?.state === 'on' ? timerEnd(auto.attributes.friendly_name) : undefined;
  return { auto, end };
}

/** "In 23 min" / "In 1 h 5 min". */
export function until(end: Date, now = Date.now()) {
  const min = Math.max(1, Math.round((end.getTime() - now) / 60e3));
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h${min % 60 ? ` ${min % 60} min` : ''}`;
}

function useNow(everyMs: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(t);
  }, [everyMs]);
  return now;
}

/** Kasa-style countdown: turn off (or on) after a while. */
export function TimerCard({ entity }: { entity: HassEntity }) {
  const { creds } = useHA();
  const { auto, end } = useTimer(entity.entity_id);
  const [error, setError] = useState<string>();
  const now = useNow(30e3);
  const on = entity.state === 'on';
  const running = end && end.getTime() > now;

  // A timer that already fired switched itself off; tidy it away.
  useEffect(() => {
    if (creds && auto && auto.state === 'off') removeAutomation(creds, auto.attributes.id).catch(() => {});
  }, [creds, auto]);

  const run = (p: Promise<unknown>) => {
    setError(undefined);
    p.catch((e) => setError(e?.message ?? String(e)));
  };

  return (
    <Card>
      <ThemedText type="smallBold">Timer</ThemedText>
      {running ? (
        <View style={styles.row}>
          <ThemedText style={styles.flex}>
            {auto?.attributes.friendly_name?.includes('timer on') ? 'Turns on' : 'Turns off'} in {until(end, now)} (
            {end.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })})
          </ThemedText>
          <Button
            title="Cancel"
            color={RED}
            onPress={() => creds && run(removeAutomation(creds, timerId(entity.entity_id)))}
          />
        </View>
      ) : (
        <>
          <ThemedText type="small" themeColor="textSecondary">
            Turn {on ? 'off' : 'on'} in…
          </ThemedText>
          <View style={styles.wrap}>
            {TIMERS.map((m) => (
              <Chip
                key={m}
                label={label(m)}
                disabled={!creds}
                onPress={() =>
                  creds && run(setTimer(creds, entity.entity_id, name(entity), !on, new Date(Date.now() + m * 60e3)))
                }
              />
            ))}
          </View>
        </>
      )}
      {error && <ThemedText style={styles.error}>{error}</ThemedText>}
    </Card>
  );
}

/** Kasa's "Away mode": random on/off in the evening so the home looks lived in. */
export function AwayCard({ entity }: { entity: HassEntity }) {
  const { creds, call } = useHA();
  const auto = useAutomation(awayId(entity.entity_id));
  const [error, setError] = useState<string>();

  const toggle = (on: boolean) => {
    if (!creds) return;
    setError(undefined);
    const p = on
      ? auto
        ? call('automation', 'turn_on', { entity_id: auto.entity_id })
        : setAway(creds, entity.entity_id, name(entity))
      : removeAutomation(creds, awayId(entity.entity_id));
    Promise.resolve(p).catch((e) => setError(e?.message ?? String(e)));
  };

  return (
    <Card>
      <View style={styles.row}>
        <View style={styles.flex}>
          <ThemedText type="smallBold">Away mode</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Switches on and off at random from sunset to 11:30 PM, so the home looks lived in.
          </ThemedText>
        </View>
        <Switch value={auto?.state === 'on'} disabled={!creds} onValueChange={toggle} />
      </View>
      {error && <ThemedText style={styles.error}>{error}</ThemedText>}
    </Card>
  );
}

type Point = { s: string; lu: number };

/** When it was on: today's timeline, today's total, and the last 7 days. From HA's history. */
export function ActivityCard({ entity }: { entity: HassEntity }) {
  const { conn } = useHA();
  const theme = useTheme();
  const [points, setPoints] = useState<Point[]>();
  const id = entity.entity_id;
  const onState = id.startsWith('vacuum.') ? 'cleaning' : 'on';
  const now = useNow(60e3);

  useEffect(() => {
    if (!conn) return;
    conn
      .sendMessagePromise<Record<string, Point[]>>({
        type: 'history/history_during_period',
        start_time: new Date(Date.now() - 7 * 864e5).toISOString(),
        entity_ids: [id],
        minimal_response: true,
        no_attributes: true,
        significant_changes_only: false,
      })
      .then((r) => setPoints(r[id] ?? []), () => setPoints([]));
  }, [conn, id, entity.last_changed]);

  if (!points) return null;

  // On-intervals in ms. The last one runs until now.
  const spans: [number, number][] = [];
  points.forEach((p, i) => {
    if (p.s !== onState) return;
    const next = points[i + 1];
    spans.push([p.lu * 1000, next ? next.lu * 1000 : now]);
  });
  const overlap = (a: number, b: number) =>
    spans.reduce((sum, [x, y]) => sum + Math.max(0, Math.min(b, y) - Math.max(a, x)), 0);

  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);
  const dayStart = midnight.getTime();
  const days = Array.from({ length: 7 }, (_, i) => {
    const start = dayStart - (6 - i) * 864e5;
    return { start, ms: overlap(start, Math.min(start + 864e5, now)) };
  });
  const max = Math.max(...days.map((d) => d.ms), 3600e3);
  const fmt = (ms: number) => {
    const min = Math.round(ms / 60e3);
    return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${min % 60} min`;
  };
  const tint = '#FFD60A';

  return (
    <Card>
      <ThemedText type="smallBold">Activity</ThemedText>
      <ThemedText>
        {onState === 'on' ? 'On' : 'Cleaning'} for {fmt(days[6].ms)} today
      </ThemedText>
      <View style={[styles.timeline, { backgroundColor: theme.backgroundSelected }]}>
        {spans
          .filter(([, y]) => y > dayStart)
          .map(([x, y]) => (
            <View
              key={x}
              style={[
                styles.segment,
                {
                  backgroundColor: tint,
                  left: `${((Math.max(x, dayStart) - dayStart) / 864e5) * 100}%`,
                  width: `${Math.max(0.5, ((y - Math.max(x, dayStart)) / 864e5) * 100)}%`,
                },
              ]}
            />
          ))}
      </View>
      <View style={styles.between}>
        {['12 AM', '6 AM', '12 PM', '6 PM', '12 AM'].map((t, i) => (
          <ThemedText key={i} type="small" themeColor="textSecondary">
            {t}
          </ThemedText>
        ))}
      </View>
      <View style={styles.bars}>
        {days.map((d) => (
          <View key={d.start} style={styles.barCol}>
            <View style={[styles.barTrack, { backgroundColor: theme.backgroundSelected }]}>
              <View style={[styles.bar, { height: `${(d.ms / max) * 100}%`, backgroundColor: tint }]} />
            </View>
            <ThemedText type="small" themeColor="textSecondary">
              {new Date(d.start).toLocaleDateString([], { weekday: 'narrow' })}
            </ThemedText>
          </View>
        ))}
      </View>
      <ThemedText type="small" themeColor="textSecondary">
        Last 7 days: {fmt(days.reduce((s, d) => s + d.ms, 0))} in total · last changed{' '}
        {new Date(entity.last_changed).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })}
      </ThemedText>
    </Card>
  );
}

type Area = { area_id: string; name: string };

/** Rename the device and move it to a room (HA areas). Admin token needed. */
export function NameRoomCard({ entity, device }: { entity: HassEntity; device?: Device }) {
  const { conn, areas, reloadRegistry } = useHA();
  const theme = useTheme();
  const [rooms, setRooms] = useState<Area[]>([]);
  const [draft, setDraft] = useState<string>();
  const [newRoom, setNewRoom] = useState<string>();
  const [error, setError] = useState<string>();
  const room = areas[entity.entity_id];

  useEffect(() => {
    conn?.sendMessagePromise<Area[]>({ type: 'config/area_registry/list' }).then(setRooms, () => {});
  }, [conn]);

  const run = (p: Promise<unknown>) => {
    setError(undefined);
    p.then(reloadRegistry, (e) => setError(e?.code === 'unauthorized' ? ADMIN_ONLY : (e?.message ?? String(e))));
  };

  const rename = () => {
    if (!conn || !draft?.trim()) return;
    run(conn.sendMessagePromise({ type: 'config/entity_registry/update', entity_id: entity.entity_id, name: draft.trim() }));
    setDraft(undefined);
  };

  // Rooms belong to the device (all its entities follow); an entity without a device gets its own.
  const move = (area_id: string) =>
    conn &&
    run(
      device
        ? conn.sendMessagePromise({ type: 'config/device_registry/update', device_id: device.id, area_id })
        : conn.sendMessagePromise({ type: 'config/entity_registry/update', entity_id: entity.entity_id, area_id }),
    );

  const create = async () => {
    if (!conn || !newRoom?.trim()) return;
    try {
      const area = await conn.sendMessagePromise<Area>({ type: 'config/area_registry/create', name: newRoom.trim() });
      setRooms((r) => [...r, area]);
      setNewRoom(undefined);
      move(area.area_id);
    } catch (e: any) {
      setError(e?.code === 'unauthorized' ? ADMIN_ONLY : (e?.message ?? String(e)));
    }
  };

  const input = [styles.input, { color: theme.text, borderColor: theme.textSecondary }];
  return (
    <Card>
      <ThemedText type="smallBold">Name & room</ThemedText>
      <View style={styles.row}>
        <TextInput
          style={[input, styles.flex]}
          value={draft ?? name(entity)}
          onChangeText={setDraft}
          onSubmitEditing={rename}
          returnKeyType="done"
          placeholder="Name"
          placeholderTextColor={theme.textSecondary}
        />
        {draft !== undefined && <Button title="Save" onPress={rename} />}
      </View>
      <View style={styles.wrap}>
        {rooms.map((r) => (
          <Chip key={r.area_id} label={r.name} selected={room === r.name} onPress={() => move(r.area_id)} />
        ))}
        {newRoom === undefined && <Chip icon="plus" label="New room" onPress={() => setNewRoom('')} />}
      </View>
      {newRoom !== undefined && (
        <View style={styles.row}>
          <TextInput
            style={[input, styles.flex]}
            value={newRoom}
            onChangeText={setNewRoom}
            onSubmitEditing={create}
            autoFocus
            returnKeyType="done"
            placeholder="Room name"
            placeholderTextColor={theme.textSecondary}
          />
          <Button title="Add" disabled={!newRoom.trim()} onPress={create} />
        </View>
      )}
      {error && <ThemedText style={styles.error}>{error}</ThemedText>}
    </Card>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  between: { flexDirection: 'row', justifyContent: 'space-between' },
  error: { color: RED },
  input: { borderWidth: 1, borderRadius: 10, padding: Spacing.two, fontSize: 16 },
  timeline: { height: 14, borderRadius: 7, overflow: 'hidden' },
  segment: { position: 'absolute', top: 0, bottom: 0 },
  bars: { flexDirection: 'row', gap: Spacing.two, height: 80, marginTop: Spacing.two },
  barCol: { flex: 1, alignItems: 'center', gap: 4 },
  barTrack: { flex: 1, width: '100%', borderRadius: 6, justifyContent: 'flex-end', overflow: 'hidden' },
  bar: { width: '100%', borderRadius: 6 },
});
