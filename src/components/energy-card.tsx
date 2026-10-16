import type { HassEntity } from 'home-assistant-js-websocket';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Card } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { name, unavailable, useHA } from '@/ha';
import { useTheme } from '@/hooks/use-theme';

type Stat = { start: number; change?: number };

const kwh = (n: number) => `${n < 10 ? n.toFixed(2) : n.toFixed(1)} kWh`;

/**
 * Live power (W) and energy used per day (kWh) for devices that measure it, e.g. a Kasa plug with energy
 * monitoring. Daily use comes from HA's long-term statistics, the same numbers as HA's Energy dashboard.
 */
export function EnergyCard() {
  const { conn, entities } = useHA();
  const theme = useTheme();
  const sensors = Object.values(entities).filter((e) => e.entity_id.startsWith('sensor.'));
  const power = sensors.filter((e) => e.attributes.device_class === 'power' && !unavailable(e));
  const energy = sensors.filter((e) => e.attributes.device_class === 'energy' && e.attributes.state_class);
  const ids = energy.map((e) => e.entity_id).sort().join();
  const [stats, setStats] = useState<Record<string, Stat[]>>({});

  useEffect(() => {
    if (!conn || !ids) return;
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - 6);
    conn
      .sendMessagePromise<Record<string, Stat[]>>({
        type: 'recorder/statistics_during_period',
        start_time: start.toISOString(),
        statistic_ids: ids.split(','),
        period: 'day',
        types: ['change'],
        units: { energy: 'kWh' },
      })
      .then(setStats, () => {});
  }, [conn, ids]);

  if (!power.length && !energy.length)
    return (
      <Card>
        <ThemedText type="smallBold">Energy</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          None of your devices measure power. A plug with energy monitoring (e.g. Kasa KP125M or EP25) shows its live watts and
          daily kWh here once it’s added.
        </ThemedText>
      </Card>
    );

  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);
  const days = Array.from({ length: 7 }, (_, i) => midnight.getTime() - (6 - i) * 864e5);
  const perDay = (id: string) => days.map((d) => (stats[id] ?? []).find((s) => sameDay(s.start, d))?.change ?? 0);
  const totals = days.map((_, i) => energy.reduce((sum, e) => sum + perDay(e.entity_id)[i], 0));
  const max = Math.max(...totals, 0.1);
  const watts = power.reduce((sum, e) => sum + (Number(e.state) || 0), 0);

  return (
    <Card>
      <ThemedText type="smallBold">Energy</ThemedText>
      {power.length > 0 && <ThemedText type="subtitle">{Math.round(watts)} W now</ThemedText>}
      {energy.length > 0 && (
        <>
          <ThemedText>{kwh(totals[6])} today</ThemedText>
          <View style={styles.bars}>
            {totals.map((t, i) => (
              <View key={days[i]} style={styles.barCol}>
                <View style={[styles.barTrack, { backgroundColor: theme.backgroundSelected }]}>
                  <View style={[styles.bar, { height: `${(t / max) * 100}%` }]} />
                </View>
                <ThemedText type="small" themeColor="textSecondary">
                  {new Date(days[i]).toLocaleDateString([], { weekday: 'narrow' })}
                </ThemedText>
              </View>
            ))}
          </View>
          <ThemedText type="small" themeColor="textSecondary">
            Last 7 days: {kwh(totals.reduce((a, b) => a + b, 0))}
          </ThemedText>
        </>
      )}
      {[...power, ...energy].map((e: HassEntity) => (
        <View key={e.entity_id} style={styles.row}>
          <ThemedText style={styles.flex} numberOfLines={1}>{name(e)}</ThemedText>
          <ThemedText themeColor="textSecondary">
            {e.attributes.device_class === 'power'
              ? `${Math.round(Number(e.state) || 0)} ${e.attributes.unit_of_measurement ?? 'W'}`
              : `${kwh(perDay(e.entity_id)[6])} today`}
          </ThemedText>
        </View>
      ))}
    </Card>
  );
}

const sameDay = (a: number, b: number) => new Date(a).toDateString() === new Date(b).toDateString();

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  bars: { flexDirection: 'row', gap: Spacing.two, height: 90 },
  barCol: { flex: 1, alignItems: 'center', gap: 4 },
  barTrack: { flex: 1, width: '100%', borderRadius: 6, justifyContent: 'flex-end', overflow: 'hidden' },
  bar: { width: '100%', backgroundColor: '#30D158', borderRadius: 6 },
});
