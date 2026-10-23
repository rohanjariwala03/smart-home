import { DatePicker, Host } from '@expo/ui/swift-ui';
import type { HassEntity } from 'home-assistant-js-websocket';
import { useState } from 'react';
import { StyleSheet, Switch, View } from 'react-native';

import {
  arriveId,
  doorbellTvId,
  doorbellTvsOf,
  leaveId,
  motionLightId,
  motionLightOf,
  nightId,
  removeAutomation,
  setArriveDisarm,
  setDoorbellTv,
  setLeaveArm,
  setMotionLight,
  setNight,
  useAutomation,
  useAutomationConfig,
  type MotionLight,
} from '@/automations';
import { Chip } from '@/components/chip';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { byDomain, isEcho, name, players, switchables, useHA } from '@/ha';

function useRun() {
  const [error, setError] = useState<string>();
  const run = (p?: Promise<unknown>) => {
    setError(undefined);
    p?.catch((e) => setError(e?.message ?? String(e)));
  };
  return { error, run };
}

const toDate = (at: string) => {
  const [h, m] = at.split(':').map(Number);
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d;
};
const toAt = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:00`;

/** Arm at night / disarm in the morning, and arm when everyone's left (HA people tracked by their phones). */
export function ArmingCard({ alarm }: { alarm: HassEntity }) {
  const { creds, entities } = useHA();
  const { error, run } = useRun();
  const id = alarm.entity_id;
  const night = useAutomation(nightId(id));
  const nightConfig = useAutomationConfig(nightId(id));
  const leave = useAutomation(leaveId(id));
  const arrive = useAutomation(arriveId(id));
  if (!creds) return null;

  const armAt = nightConfig?.triggers?.[0]?.at ?? '23:00:00';
  const disarmAt = nightConfig?.triggers?.[1]?.at ?? '07:00:00';
  const people = byDomain(entities, 'person');
  const tracked = people.filter((p) => p.attributes.device_trackers?.length);
  const label = name(alarm);

  return (
    <View style={styles.section}>
      <Row label="Arm at night" value={!!night} onChange={(on) => run(on ? setNight(creds, id, label, armAt, disarmAt) : removeAutomation(creds, nightId(id)))} />
      {night && (
        <View style={styles.times}>
          <Time title="Arm at" at={armAt} onChange={(at) => run(setNight(creds, id, label, at, disarmAt))} />
          <Time title="Disarm at" at={disarmAt} onChange={(at) => run(setNight(creds, id, label, armAt, at))} />
        </View>
      )}
      <Row
        label="Arm when everyone leaves"
        value={!!leave}
        onChange={(on) => run(on ? setLeaveArm(creds, id, label) : removeAutomation(creds, leaveId(id)))}
      />
      <Row
        label="Disarm when someone gets home"
        value={!!arrive}
        onChange={(on) => run(on ? setArriveDisarm(creds, id, label) : removeAutomation(creds, arriveId(id)))}
      />
      <ThemedText type="small" themeColor="textSecondary">
        {tracked.length
          ? `Home: ${tracked.map((p) => `${name(p)} (${p.state === 'home' ? 'home' : 'away'})`).join(', ')}`
          : 'Nobody is tracked yet. In the Home Assistant app turn on Location (Settings › Companion app › Location), then in HA add your phone to your person (Settings › People).'}
      </ThemedText>
      {error && <ThemedText type="small" style={styles.error}>{error}</ThemedText>}
    </View>
  );
}

export function Time({ title, at, onChange }: { title: string; at: string; onChange: (at: string) => void }) {
  return (
    <View style={styles.time}>
      <ThemedText type="small" themeColor="textSecondary">{title}</ThemedText>
      <Host matchContents>
        <DatePicker displayedComponents={['hourAndMinute']} selection={toDate(at)} onDateChange={(d) => onChange(toAt(d))} />
      </Host>
    </View>
  );
}

export function Row({ label, value, onChange }: { label: string; value: boolean; onChange: (on: boolean) => void }) {
  return (
    <View style={styles.row}>
      <ThemedText style={styles.flex}>{label}</ThemedText>
      <Switch value={value} onValueChange={onChange} />
    </View>
  );
}

const MINUTES = [1, 5, 10, 15, 30];

/** Motion on this camera switches the chosen lights on for a few minutes. */
export function MotionLightCard({ camera, motion }: { camera: HassEntity; motion: HassEntity }) {
  const { creds, entities, devices } = useHA();
  const { error, run } = useRun();
  const id = motionLightId(camera.entity_id);
  const auto = useAutomation(id);
  const saved = motionLightOf(useAutomationConfig(id));
  const [draft, setDraft] = useState<MotionLight>();
  if (!creds) return null;

  const m = draft ?? saved ?? { lights: [], minutes: 5, darkOnly: true };
  const open = !!auto || !!draft;
  const save = (next: MotionLight) => {
    setDraft(next);
    run(
      next.lights.length
        ? setMotionLight(creds, camera.entity_id, motion.entity_id, name(camera), next)
        : auto && removeAutomation(creds, id),
    );
  };
  const toggleLight = (light: string) =>
    save({ ...m, lights: m.lights.includes(light) ? m.lights.filter((l) => l !== light) : [...m.lights, light] });

  return (
    <View style={styles.section}>
      <Row
        label="Motion turns on lights"
        value={open}
        onChange={(on) => {
          setDraft(on ? m : undefined);
          if (!on && auto) run(removeAutomation(creds, id));
        }}
      />
      {open && (
        <>
          <View style={styles.wrap}>
            {switchables(entities, devices).map((e) => (
              <Chip key={e.entity_id} label={name(e)} selected={m.lights.includes(e.entity_id)} onPress={() => toggleLight(e.entity_id)} />
            ))}
          </View>
          <ThemedText type="small" themeColor="textSecondary">For</ThemedText>
          <View style={styles.wrap}>
            {MINUTES.map((n) => (
              <Chip key={n} label={`${n} min`} selected={m.minutes === n} onPress={() => save({ ...m, minutes: n })} />
            ))}
          </View>
          <Row label="Only after dark" value={m.darkOnly} onChange={(darkOnly) => save({ ...m, darkOnly })} />
          <ThemedText type="small" themeColor="textSecondary">
            {m.lights.length ? 'More motion keeps them on longer. ' : 'Pick the lights to turn on. '}
            Motion arrives within seconds while the cameras are armed.
          </ThemedText>
        </>
      )}
      {error && <ThemedText type="small" style={styles.error}>{error}</ThemedText>}
    </View>
  );
}

/** Doorbell press shows the doorbell's live view on the chosen TVs (Blink Instant Events' show_on_tv). */
export function DoorbellTvCard({ camera, device, event }: { camera: HassEntity; device: string; event: string }) {
  const { creds, entities, devices } = useHA();
  const { error, run } = useRun();
  const id = doorbellTvId(camera.entity_id);
  const auto = useAutomation(id);
  const saved = doorbellTvsOf(useAutomationConfig(id));
  const [draft, setDraft] = useState<string[]>();
  if (!creds) return null;

  const tvs = players(entities, devices).filter((e) => !isEcho(e));
  const chosen = draft ?? saved;
  const save = (next: string[]) => {
    setDraft(next);
    run(next.length ? setDoorbellTv(creds, camera.entity_id, name(camera), device, event, next) : auto && removeAutomation(creds, id));
  };

  return (
    <View style={styles.section}>
      <Row
        label="Show on TV when it rings"
        value={!!auto || !!draft}
        onChange={(on) => {
          if (on) save(tvs.length === 1 ? [tvs[0].entity_id] : []);
          else {
            setDraft(undefined);
            if (auto) run(removeAutomation(creds, id));
          }
        }}
      />
      {(!!auto || !!draft) && (
        <>
          <View style={styles.wrap}>
            {tvs.map((e) => (
              <Chip
                key={e.entity_id}
                label={name(e)}
                selected={chosen.includes(e.entity_id)}
                onPress={() => save(chosen.includes(e.entity_id) ? chosen.filter((t) => t !== e.entity_id) : [...chosen, e.entity_id])}
              />
            ))}
          </View>
          <ThemedText type="small" themeColor="textSecondary">
            {tvs.length ? 'Live for a minute, only when the TV is already on. Needs Chromecast built in (Google TV, Android TV) or a Chromecast.' : 'No TVs in Home Assistant yet.'}
          </ThemedText>
        </>
      )}
      {error && <ThemedText type="small" style={styles.error}>{error}</ThemedText>}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  section: { gap: Spacing.two },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  times: { flexDirection: 'row', gap: Spacing.three },
  time: { gap: 4 },
  error: { color: '#E5484D' },
});
