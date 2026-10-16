import { DatePicker, Host } from '@expo/ui/swift-ui';
import type { HassEntity } from 'home-assistant-js-websocket';
import { useState } from 'react';
import { Alert, Button, Pressable, StyleSheet, Switch, View } from 'react-native';

import { Chip } from '@/components/chip';
import { Card } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { name, useHA } from '@/ha';
import {
  addSchedule,
  DAYS,
  deleteSchedule,
  describe,
  duration,
  useSchedules,
  type Day,
  type Schedule,
  type When,
} from '@/schedules';

const AUTO_OFF = [5, 15, 30, 60, 120];

// Things a schedule can do, per domain. Lights/switches: on/off; vacuums: start/dock; Blink: arm/disarm.
const actionsFor = (domain: string): [string, string][] =>
  domain === 'vacuum'
    ? [['vacuum.start', 'Start cleaning'], ['vacuum.return_to_base', 'Dock']]
    : domain === 'alarm_control_panel'
      ? [['alarm_control_panel.alarm_arm_away', 'Arm'], ['alarm_control_panel.alarm_disarm', 'Disarm']]
      : [[`${domain}.turn_on`, 'On'], [`${domain}.turn_off`, 'Off']];

export function ScheduleCard({ entity }: { entity: HassEntity }) {
  const { creds, call } = useHA();
  const { schedules, error: loadError } = useSchedules(entity.entity_id);
  const [error, setError] = useState<string>();
  const [adding, setAdding] = useState(false);
  const domain = entity.entity_id.split('.')[0];
  const autoOff = schedules.find((s) => 'onFor' in s.when);
  const timed = schedules.filter((s) => s !== autoOff);

  const run = (p: Promise<unknown>) => {
    setError(undefined);
    return p.catch((e) => setError(e?.message ?? String(e)));
  };
  const add = (s: Schedule) => creds && run(addSchedule(creds, s, `${name(entity)}: ${describe(s).title}`));
  const remove = (id: string) => creds && run(deleteSchedule(creds, id));

  const setAutoOff = async (min?: number) => {
    if (autoOff) await remove(autoOff.id);
    if (min) add({ target: entity.entity_id, service: `${domain}.turn_off`, when: { onFor: min }, days: [] });
  };

  return (
    <Card>
      <ThemedText type="smallBold">Schedules</ThemedText>
      {timed.map((s) => {
        const d = describe(s);
        return (
          <View key={s.id} style={styles.row}>
            <View style={styles.flex}>
              <ThemedText>{d.title}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {d.days}
              </ThemedText>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Delete ${d.title}`}
              hitSlop={8}
              onPress={() =>
                Alert.alert('Delete schedule?', `${d.title}, ${d.days}`, [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Delete', style: 'destructive', onPress: () => remove(s.id) },
                ])
              }>
              <ThemedText type="small" themeColor="textSecondary">
                Delete
              </ThemedText>
            </Pressable>
            <Switch
              accessibilityLabel={`${d.title} enabled`}
              value={s.enabled}
              onValueChange={(on) => void call('automation', on ? 'turn_on' : 'turn_off', { entity_id: s.automation })}
            />
          </View>
        );
      })}

      {adding ? (
        <NewSchedule
          actions={actionsFor(domain)}
          onCancel={() => setAdding(false)}
          onSave={(s) => {
            setAdding(false);
            add({ ...s, target: entity.entity_id });
          }}
        />
      ) : (
        <Button title="Add schedule" disabled={!creds} onPress={() => setAdding(true)} />
      )}

      {domain !== 'vacuum' && domain !== 'alarm_control_panel' && (
        <>
          <ThemedText type="smallBold">Auto-off</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Turns off by itself this long after it&apos;s switched on, however it was switched on.
          </ThemedText>
          <View style={styles.wrap}>
            <Chip label="Never" selected={!autoOff} onPress={() => setAutoOff()} />
            {AUTO_OFF.map((m) => (
              <Chip
                key={m}
                label={duration(m)}
                selected={!!autoOff && 'onFor' in autoOff.when && autoOff.when.onFor === m}
                onPress={() => setAutoOff(m)}
              />
            ))}
          </View>
        </>
      )}

      {(error ?? loadError) && (
        <ThemedText type="small" style={styles.error}>
          {error ?? loadError}
        </ThemedText>
      )}
    </Card>
  );
}

function NewSchedule({ actions, onSave, onCancel }: {
  actions: [string, string][];
  onSave: (s: Omit<Schedule, 'target'>) => void;
  onCancel: () => void;
}) {
  const [service, setService] = useState(actions[0][0]);
  const [kind, setKind] = useState<'time' | 'sunrise' | 'sunset'>('time');
  const [time, setTime] = useState(() => new Date(2000, 0, 1, 7, 0));
  const [days, setDays] = useState<Day[]>([...DAYS]);
  const pad = (n: number) => String(n).padStart(2, '0');
  const when: When = kind === 'time' ? { at: `${pad(time.getHours())}:${pad(time.getMinutes())}:00` } : { sun: kind };

  return (
    <View style={styles.form}>
      <View style={styles.wrap}>
        {actions.map(([s, label]) => (
          <Chip key={s} label={label} selected={service === s} onPress={() => setService(s)} />
        ))}
      </View>
      <View style={styles.wrap}>
        <Chip icon="clock" label="Time" selected={kind === 'time'} onPress={() => setKind('time')} />
        <Chip icon="sunrise" label="Sunrise" selected={kind === 'sunrise'} onPress={() => setKind('sunrise')} />
        <Chip icon="sunset" label="Sunset" selected={kind === 'sunset'} onPress={() => setKind('sunset')} />
      </View>
      {kind === 'time' && (
        <Host matchContents>
          <DatePicker title="Time" displayedComponents={['hourAndMinute']} selection={time} onDateChange={setTime} />
        </Host>
      )}
      <View style={styles.wrap}>
        {DAYS.map((d) => (
          <Chip
            key={d}
            label={d[0].toUpperCase() + d.slice(1, 2)}
            selected={days.includes(d)}
            onPress={() => setDays(days.includes(d) ? days.filter((x) => x !== d) : DAYS.filter((x) => x === d || days.includes(x)))}
          />
        ))}
      </View>
      <View style={styles.row}>
        <Button title="Cancel" color="#888" onPress={onCancel} />
        <View style={styles.flex} />
        <Button title="Save" disabled={!days.length} onPress={() => onSave({ service, when, days })} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  form: { gap: Spacing.three, paddingVertical: Spacing.two },
  error: { color: '#E5484D' },
});
