import { SymbolView, type SFSymbol } from 'expo-symbols';
import type { Connection, HassEntity } from 'home-assistant-js-websocket';
import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { byDomain, useHA } from '@/ha';
import { useTheme } from '@/hooks/use-theme';

// Today's weather from Home Assistant's weather entity (Met.no by default), inspired by Apple's Weather app.

export const SKY: Record<string, [string, SFSymbol]> = {
  sunny: ['Sunny', 'sun.max.fill'],
  'clear-night': ['Clear', 'moon.stars.fill'],
  partlycloudy: ['Partly cloudy', 'cloud.sun.fill'],
  cloudy: ['Cloudy', 'cloud.fill'],
  fog: ['Fog', 'cloud.fog.fill'],
  rainy: ['Rain', 'cloud.rain.fill'],
  pouring: ['Heavy rain', 'cloud.heavyrain.fill'],
  snowy: ['Snow', 'cloud.snow.fill'],
  'snowy-rainy': ['Sleet', 'cloud.sleet.fill'],
  hail: ['Hail', 'cloud.hail.fill'],
  lightning: ['Thunder', 'cloud.bolt.fill'],
  'lightning-rainy': ['Thunderstorm', 'cloud.bolt.rain.fill'],
  windy: ['Windy', 'wind'],
  'windy-variant': ['Windy', 'wind'],
};
export const sky = (condition?: string): [string, SFSymbol] => SKY[condition ?? ''] ?? [condition ?? '', 'cloud.fill'];

// Cards take the sky's colour, like Apple's backgrounds.
const BACKDROP: Record<string, string> = {
  sunny: '#2E6DB4',
  partlycloudy: '#3A6597',
  'clear-night': '#141C38',
  cloudy: '#46566B',
  fog: '#57616E',
  rainy: '#33445A',
  pouring: '#2A3749',
  snowy: '#5A6D86',
  'snowy-rainy': '#4C5D74',
  hail: '#44536A',
  lightning: '#2B2F45',
  'lightning-rainy': '#2B2F45',
};

export type Forecast = {
  datetime: string;
  condition?: string;
  temperature?: number;
  templow?: number;
  precipitation?: number;
  precipitation_probability?: number;
  wind_speed?: number;
};

/** The weather entity's forecast, kept current; empty if it has none of this kind. */
export function useForecast(conn: Connection | null, entityId: string | undefined, kind: 'daily' | 'hourly') {
  const [forecast, setForecast] = useState<Forecast[]>([]);
  useEffect(() => {
    if (!conn || !entityId) return;
    const sub = conn
      .subscribeMessage<{ forecast?: Forecast[] }>((m) => setForecast(m.forecast ?? []), {
        type: 'weather/subscribe_forecast',
        forecast_type: kind,
        entity_id: entityId,
      })
      .catch(() => undefined);
    return () => void sub.then((unsub) => unsub?.());
  }, [conn, entityId, kind]);
  return forecast;
}

export const useWeatherEntity = () => byDomain(useHA().entities, 'weather')[0] as HassEntity | undefined;

const round = (n?: number) => (n == null ? '–' : `${Math.round(n)}`);
const hour = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: 'numeric' });
const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

/** Small card for the phone's Home: now, high and low. Tap for the full view. */
export function WeatherCard() {
  const { conn } = useHA();
  const weather = useWeatherEntity();
  const daily = useForecast(conn, weather?.entity_id, 'daily');
  const [open, setOpen] = useState(false);
  if (!weather) return null;
  const [label, icon] = sky(weather.state);
  const today = daily[0];
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Weather: ${round(weather.attributes.temperature)} degrees, ${label}`}
        accessibilityHint="Shows today's weather"
        onPress={() => setOpen(true)}
        style={({ pressed }) => [styles.card, { backgroundColor: BACKDROP[weather.state] ?? BACKDROP.cloudy }, pressed && styles.pressed]}>
        <SymbolView name={icon} size={34} type="multicolor" />
        <View style={styles.flex}>
          <Text style={styles.cardTemp}>{round(weather.attributes.temperature)}°</Text>
          <Text style={styles.cardSub}>{label}</Text>
        </View>
        {today && (
          <Text style={styles.cardSub}>
            H: {round(today.temperature)}°  L: {round(today.templow)}°
          </Text>
        )}
        <SymbolView name="chevron.right" size={14} tintColor="rgba(255,255,255,0.6)" />
      </Pressable>
      {open && <WeatherSheet onClose={() => setOpen(false)} />}
    </>
  );
}

/** Today in detail, as a sheet like the app's others: now, the rest of today hour by hour, and the details. */
export function WeatherSheet({ onClose }: { onClose: () => void }) {
  const { conn, entities } = useHA();
  const weather = useWeatherEntity();
  const hourly = useForecast(conn, weather?.entity_id, 'hourly');
  const daily = useForecast(conn, weather?.entity_id, 'daily');
  const theme = useTheme();
  const [w, setW] = useState(0);
  if (!weather) return null;

  const a = weather.attributes;
  const [label, icon] = sky(weather.state);
  const today = daily[0];
  // The hours left today; late in the evening, at least the next six.
  const midnight = new Date().setHours(24, 0, 0, 0);
  const ahead = hourly.filter((h) => +new Date(h.datetime) > +new Date() - 3600_000);
  const left = ahead.filter((h) => +new Date(h.datetime) < midnight);
  const hours = left.length >= 6 ? left : ahead.slice(0, 6);
  const rain = Math.max(0, ...left.map((h) => h.precipitation_probability ?? 0));
  const sun = entities['sun.sun']?.attributes;

  const details = [
    a.apparent_temperature != null && { icon: 'thermometer.medium', title: 'Feels like', value: `${round(a.apparent_temperature)}°` },
    (today?.precipitation != null || left.length > 0) && {
      icon: 'umbrella.fill',
      title: 'Rain today',
      value: `${rain}%`,
      note: today?.precipitation ? `${today.precipitation} ${a.precipitation_unit ?? 'mm'} expected` : 'None expected',
    },
    a.wind_speed != null && {
      icon: 'wind',
      title: 'Wind',
      value: `${Math.round(a.wind_speed)}`,
      unit: a.wind_speed_unit,
      note: a.wind_bearing != null ? `From the ${COMPASS[Math.round(a.wind_bearing / 45) % 8]}` : undefined,
    },
    a.humidity != null && { icon: 'humidity.fill', title: 'Humidity', value: `${Math.round(a.humidity)}%`, note: a.dew_point != null ? `Dew point ${round(a.dew_point)}°` : undefined },
    a.uv_index != null && { icon: 'sun.max.fill', title: 'UV index', value: `${Math.round(a.uv_index)}`, note: uvWord(a.uv_index) },
    sun?.next_rising && { icon: 'sunrise.fill', title: 'Sunrise', value: time(sun.next_rising) },
    sun?.next_setting && { icon: 'sunset.fill', title: 'Sunset', value: time(sun.next_setting) },
    a.cloud_coverage != null && { icon: 'cloud.fill', title: 'Clouds', value: `${Math.round(a.cloud_coverage)}%` },
    a.visibility != null && { icon: 'eye.fill', title: 'Visibility', value: `${Math.round(a.visibility)}`, unit: a.visibility_unit },
    a.pressure != null && { icon: 'gauge.with.dots.needle.33percent', title: 'Pressure', value: `${Math.round(a.pressure)}`, unit: a.pressure_unit },
  ].filter((d): d is { icon: SFSymbol; title: string; value: string; unit?: string; note?: string } => !!d);
  const cols = w >= 560 ? 3 : 2;

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" supportedOrientations={['portrait', 'landscape']} onRequestClose={onClose}>
      <ThemedView style={styles.flex}>
        <View style={styles.header}>
          <View style={styles.flex}>
            <ThemedText type="subtitle">Today</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {new Date().toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' })} · updated{' '}
              {time(weather.last_updated)}
            </ThemedText>
          </View>
          <Pressable onPress={onClose} accessibilityRole="button" hitSlop={12}>
            <ThemedText type="linkPrimary">Done</ThemedText>
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.body} onLayout={(e) => setW(e.nativeEvent.layout.width - 2 * Spacing.three)}>
          <View style={[styles.hero, { backgroundColor: BACKDROP[weather.state] ?? BACKDROP.cloudy }]}>
            <View style={styles.row}>
              <View style={styles.flex}>
                <Text style={styles.temp}>{round(a.temperature)}°</Text>
                <Text style={styles.label}>{label}</Text>
              </View>
              <SymbolView name={icon} size={72} type="multicolor" />
            </View>
            {today && <Range low={today.templow} high={today.temperature} now={a.temperature} />}
          </View>

          {hours.length > 0 && (
            <Card title={left.length >= 6 ? 'Rest of today' : 'Next hours'} icon="clock">
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.hours}>
                {hours.map((h, i) => (
                  <View key={h.datetime} style={styles.hour} accessible accessibilityLabel={`${i === 0 ? 'Now' : hour(h.datetime)}, ${round(h.temperature)} degrees, ${sky(h.condition)[0]}`}>
                    <ThemedText type="smallBold">{i === 0 ? 'Now' : hour(h.datetime)}</ThemedText>
                    <SymbolView name={sky(h.condition)[1]} size={26} type="multicolor" />
                    <ThemedText style={styles.hourTemp}>{round(h.temperature)}°</ThemedText>
                    <Text style={styles.rain}>{h.precipitation_probability ? `${h.precipitation_probability}%` : ' '}</Text>
                  </View>
                ))}
              </ScrollView>
            </Card>
          )}

          {w > 0 && (
            <View style={styles.grid}>
              {details.map((d) => (
                <ThemedView key={d.title} type="backgroundElement" style={[styles.tile, { width: (w - Spacing.two * (cols - 1)) / cols }]}>
                  <View style={styles.row}>
                    <SymbolView name={d.icon} size={13} tintColor={theme.textSecondary} />
                    <ThemedText type="small" themeColor="textSecondary">{d.title}</ThemedText>
                  </View>
                  <ThemedText style={styles.value} numberOfLines={1}>
                    {d.value}
                    {d.unit && <ThemedText type="small" themeColor="textSecondary"> {d.unit}</ThemedText>}
                  </ThemedText>
                  {d.note && <ThemedText type="small" themeColor="textSecondary">{d.note}</ThemedText>}
                </ThemedView>
              ))}
            </View>
          )}
          {a.attribution && <ThemedText type="small" themeColor="textSecondary" style={styles.attribution}>{a.attribution}</ThemedText>}
        </ScrollView>
      </ThemedView>
    </Modal>
  );
}

function Card({ title, icon, children }: { title: string; icon: SFSymbol; children: React.ReactNode }) {
  const theme = useTheme();
  return (
    <ThemedView type="backgroundElement" style={styles.section}>
      <View style={styles.row}>
        <SymbolView name={icon} size={13} tintColor={theme.textSecondary} />
        <ThemedText type="small" themeColor="textSecondary">{title}</ThemedText>
      </View>
      {children}
    </ThemedView>
  );
}

/** Today's low to high as a bar, with a dot where it is now. */
function Range({ low, high, now }: { low?: number; high?: number; now?: number }) {
  if (low == null || high == null) return null;
  const at = now == null || high === low ? null : Math.min(1, Math.max(0, (now - low) / (high - low)));
  return (
    <View style={styles.rangeRow} accessible accessibilityLabel={`Today between ${round(low)} and ${round(high)} degrees`}>
      <Text style={styles.hilo}>L {round(low)}°</Text>
      <View style={styles.range}>
        {at != null && <View style={[styles.dot, { left: `${at * 100}%` }]} />}
      </View>
      <Text style={styles.hilo}>H {round(high)}°</Text>
    </View>
  );
}

const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const uvWord = (uv: number) => (uv < 3 ? 'Low' : uv < 6 ? 'Moderate' : uv < 8 ? 'High' : uv < 11 ? 'Very high' : 'Extreme');

const styles = StyleSheet.create({
  flex: { flex: 1 },
  pressed: { opacity: 0.8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  card: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16, borderRadius: 20 },
  section: { padding: Spacing.three, borderRadius: 20, gap: Spacing.two },
  cardTemp: { color: '#fff', fontSize: 28, fontWeight: '300' },
  cardSub: { color: 'rgba(255,255,255,0.8)', fontSize: 14, fontWeight: '500' },
  header: { flexDirection: 'row', alignItems: 'flex-start', padding: Spacing.three },
  body: { paddingHorizontal: Spacing.three, paddingBottom: Spacing.five, gap: Spacing.three },
  hero: { borderRadius: 24, padding: 20, gap: 18 },
  temp: { color: '#fff', fontSize: 80, fontWeight: '200', letterSpacing: -3, fontVariant: ['tabular-nums'] },
  label: { color: '#fff', fontSize: 20, fontWeight: '500' },
  rangeRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  hilo: { color: '#fff', fontSize: 15, fontWeight: '600', fontVariant: ['tabular-nums'] },
  range: { flex: 1, height: 6, borderRadius: 3, backgroundColor: '#FFC24B', justifyContent: 'center' },
  dot: { position: 'absolute', width: 12, height: 12, marginLeft: -6, borderRadius: 6, backgroundColor: '#fff', borderWidth: 2, borderColor: 'rgba(0,0,0,0.25)' },
  hours: { gap: 6 },
  hour: { width: 58, alignItems: 'center', gap: 8, paddingVertical: 4 },
  hourTemp: { fontSize: 18, fontWeight: '600' },
  rain: { color: '#0A84FF', fontSize: 12, fontWeight: '700' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  tile: { borderRadius: 18, padding: 14, gap: 4, minHeight: 96 },
  value: { fontSize: 26, fontWeight: '500', fontVariant: ['tabular-nums'], lineHeight: 32 },
  attribution: { textAlign: 'center' },
});
