import { SymbolView, type SFSymbol } from 'expo-symbols';
import type { Connection, HassEntity } from 'home-assistant-js-websocket';
import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { byDomain, useHA } from '@/ha';

// Today's weather the way Apple's Weather app shows it, from Home Assistant's weather entity (Met.no by default):
// now, the details, the next 12 hours as a line, every hour, and the next days with their range.

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

// The panel takes the sky's colour, like Apple's backgrounds.
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
const day = (iso: string, i: number) => (i === 0 ? 'Today' : new Date(iso).toLocaleDateString([], { weekday: 'short' }));
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

/** Today's weather in full, over a dimmed screen: tap outside or ✕ to close. */
export function WeatherSheet({ onClose }: { onClose: () => void }) {
  const { conn } = useHA();
  const weather = useWeatherEntity();
  const hourly = useForecast(conn, weather?.entity_id, 'hourly');
  const daily = useForecast(conn, weather?.entity_id, 'daily');
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  if (!weather) return null;

  const a = weather.attributes;
  const [label, icon] = sky(weather.state);
  const panel = Math.min(width - 32, 1100);
  const wide = panel >= 760;
  const today = daily[0];
  const details: { icon: SFSymbol; title: string; value: string; unit?: string; note?: string }[] = [
    a.humidity != null && { icon: 'humidity.fill' as SFSymbol, title: 'Humidity', value: `${Math.round(a.humidity)}%` },
    a.wind_speed != null && {
      icon: 'wind' as SFSymbol,
      title: 'Wind',
      value: `${Math.round(a.wind_speed)}`,
      unit: a.wind_speed_unit,
      note: a.wind_bearing != null ? `From the ${COMPASS[Math.round(a.wind_bearing / 45) % 8]}` : undefined,
    },
    a.pressure != null && { icon: 'gauge.with.dots.needle.33percent' as SFSymbol, title: 'Pressure', value: `${Math.round(a.pressure)}`, unit: a.pressure_unit },
    a.dew_point != null && { icon: 'thermometer.medium' as SFSymbol, title: 'Dew point', value: `${round(a.dew_point)}°` },
    a.cloud_coverage != null && { icon: 'cloud.fill' as SFSymbol, title: 'Clouds', value: `${Math.round(a.cloud_coverage)}%` },
    a.uv_index != null && { icon: 'sun.max.fill' as SFSymbol, title: 'UV index', value: `${Math.round(a.uv_index)}`, note: uvWord(a.uv_index) },
    a.visibility != null && { icon: 'eye.fill' as SFSymbol, title: 'Visibility', value: `${Math.round(a.visibility)}`, unit: a.visibility_unit },
    a.apparent_temperature != null && { icon: 'thermometer.sun.fill' as SFSymbol, title: 'Feels like', value: `${round(a.apparent_temperature)}°` },
  ].filter((d): d is { icon: SFSymbol; title: string; value: string; unit?: string; note?: string } => !!d);

  const next12 = hourly.slice(0, 13);
  const now = (
    <View style={styles.now}>
      <Text style={styles.place}>{a.friendly_name ?? 'Weather'}</Text>
      <Text style={styles.updated}>Updated {new Date(weather.last_updated).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</Text>
      <View style={styles.row}>
        <Text style={styles.temp}>{round(a.temperature)}°</Text>
        <SymbolView name={icon} size={48} type="multicolor" />
      </View>
      <Text style={styles.label}>{label}</Text>
      {today && (
        <Text style={styles.hilo}>
          H: {round(today.temperature)}°   L: {round(today.templow)}°
        </Text>
      )}
    </View>
  );
  const chart = next12.length > 1 && (
    <Section title="Temperature, next 12 hours" icon="chart.xyaxis.line" style={styles.flex}>
      <Line points={next12.map((h) => h.temperature ?? 0)} labels={next12.map((h, i) => (i % 3 === 0 ? (i === 0 ? 'Now' : hour(h.datetime)) : ''))} />
    </Section>
  );
  const grid = details.length > 0 && (
    <View style={[styles.grid, wide && styles.flex]}>
      {details.map((d) => (
        <View key={d.title} style={[styles.tile, { width: wide ? '23.5%' : '48.5%' }]}>
          <View style={styles.row}>
            <SymbolView name={d.icon} size={13} tintColor="rgba(255,255,255,0.6)" />
            <Text style={styles.caption}>{d.title.toUpperCase()}</Text>
          </View>
          <Text style={styles.value} numberOfLines={1}>
            {d.value}
            {d.unit && <Text style={styles.unit}> {d.unit}</Text>}
          </Text>
          {d.note && <Text style={styles.note}>{d.note}</Text>}
        </View>
      ))}
    </View>
  );
  const week = daily.length > 0 && (
    <Section title={`${Math.min(daily.length, 7)}-day forecast`} icon="calendar" style={wide ? styles.flex : undefined}>
      <Days days={daily.slice(0, 7)} />
    </Section>
  );
  const hours = hourly.length > 0 && (
    <Section title="Hourly forecast" icon="clock">
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.hours}>
        {hourly.slice(0, 24).map((h, i) => {
          const [, hIcon] = sky(h.condition);
          return (
            <View key={h.datetime} style={styles.hour} accessible accessibilityLabel={`${i === 0 ? 'Now' : hour(h.datetime)}, ${round(h.temperature)} degrees, ${sky(h.condition)[0]}`}>
              <Text style={styles.hourTime}>{i === 0 ? 'Now' : hour(h.datetime)}</Text>
              <SymbolView name={hIcon} size={22} type="multicolor" />
              <Text style={styles.hourTemp}>{round(h.temperature)}°</Text>
              {!!h.precipitation_probability && <Text style={styles.rain}>{h.precipitation_probability}%</Text>}
            </View>
          );
        })}
      </ScrollView>
    </Section>
  );

  return (
    <Modal visible transparent animationType="fade" supportedOrientations={['portrait', 'landscape']} onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close weather" accessibilityRole="button">
        {/* The panel catches its own taps, so only the dimmed area closes. */}
        <Pressable
          onPress={() => {}}
          accessible={false}
          style={[styles.panel, { width: panel, maxHeight: height - insets.top - insets.bottom - 32, backgroundColor: BACKDROP[weather.state] ?? BACKDROP.cloudy }]}>
          <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" hitSlop={12} style={styles.close}>
            <SymbolView name="xmark" size={14} tintColor="#fff" weight="bold" />
          </Pressable>
          <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
            {wide ? (
              <>
                <View style={styles.columns}>
                  {now}
                  {chart}
                </View>
                <View style={styles.columns}>
                  {grid}
                  {week}
                </View>
                {hours}
              </>
            ) : (
              <>
                {now}
                {hours}
                {chart}
                {week}
                {grid}
              </>
            )}
            {a.attribution && <Text style={styles.attribution}>{a.attribution}</Text>}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function Section({ title, icon, style, children }: { title: string; icon: SFSymbol; style?: object; children: React.ReactNode }) {
  return (
    <View style={[styles.section, style]}>
      <View style={styles.row}>
        <SymbolView name={icon} size={13} tintColor="rgba(255,255,255,0.6)" />
        <Text style={styles.caption}>{title.toUpperCase()}</Text>
      </View>
      {children}
    </View>
  );
}

/** A temperature line with a dot and value every few hours; drawn with views (a bar turned between each pair). */
function Line({ points, labels }: { points: number[]; labels: string[] }) {
  const [w, setW] = useState(0);
  const H = 110;
  const pad = 22;
  const lo = Math.min(...points);
  const hi = Math.max(...points);
  const y = (v: number) => pad + (hi === lo ? 0.5 : (hi - v) / (hi - lo)) * (H - pad * 2);
  const x = (i: number) => (i / (points.length - 1)) * (w - 16) + 8;
  return (
    <View
      onLayout={(e) => setW(e.nativeEvent.layout.width)}
      style={{ height: H + 18 }}
      accessible
      accessibilityLabel={`Between ${Math.round(lo)} and ${Math.round(hi)} degrees over the next 12 hours`}>
      {w > 0 &&
        points.slice(1).map((v, i) => {
          const x1 = x(i), y1 = y(points[i]), x2 = x(i + 1), y2 = y(v);
          const len = Math.hypot(x2 - x1, y2 - y1);
          return (
            <View
              key={i}
              style={[styles.segment, { width: len, left: (x1 + x2) / 2 - len / 2, top: (y1 + y2) / 2 - 1.5, transform: [{ rotate: `${Math.atan2(y2 - y1, x2 - x1)}rad` }] }]}
            />
          );
        })}
      {w > 0 &&
        points.map((v, i) =>
          labels[i] ? (
            <View key={i} style={[styles.mark, { left: x(i) - 24, top: y(v) - 22 }]}>
              <Text style={styles.markTemp}>{Math.round(v)}°</Text>
              <View style={styles.dot} />
            </View>
          ) : null,
        )}
      {w > 0 &&
        labels.map((l, i) => (l ? <Text key={i} style={[styles.markTime, { left: x(i) - 24, top: H }]}>{l}</Text> : null))}
    </View>
  );
}

/** Each day's low to high as a bar placed within the week's range, like Apple's. */
function Days({ days }: { days: Forecast[] }) {
  const lows = days.map((d) => d.templow ?? d.temperature ?? 0);
  const highs = days.map((d) => d.temperature ?? 0);
  const lo = Math.min(...lows);
  const hi = Math.max(...highs);
  const at = (v: number) => (hi === lo ? 0 : (v - lo) / (hi - lo));
  return (
    <View style={styles.days}>
      {days.map((d, i) => {
        const [label, icon] = sky(d.condition);
        return (
          <View key={d.datetime} style={styles.day} accessible accessibilityLabel={`${day(d.datetime, i)}: ${label}, low ${round(lows[i])}, high ${round(highs[i])}`}>
            <Text style={styles.dayName}>{day(d.datetime, i)}</Text>
            <View style={styles.dayIcon}>
              <SymbolView name={icon} size={20} type="multicolor" />
              {!!d.precipitation_probability && <Text style={styles.rain}>{d.precipitation_probability}%</Text>}
            </View>
            <Text style={styles.dayLow}>{round(lows[i])}°</Text>
            <View style={styles.range}>
              <View style={[styles.rangeFill, { left: `${at(lows[i]) * 100}%`, right: `${(1 - at(highs[i])) * 100}%` }]} />
            </View>
            <Text style={styles.dayHigh}>{round(highs[i])}°</Text>
          </View>
        );
      })}
    </View>
  );
}

const uvWord = (uv: number) => (uv < 3 ? 'Low' : uv < 6 ? 'Moderate' : uv < 8 ? 'High' : uv < 11 ? 'Very high' : 'Extreme');

const GLASS = 'rgba(255,255,255,0.12)';
const styles = StyleSheet.create({
  flex: { flex: 1 },
  pressed: { opacity: 0.8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  card: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16, borderRadius: 20 },
  cardTemp: { color: '#fff', fontSize: 28, fontWeight: '300' },
  cardSub: { color: 'rgba(255,255,255,0.8)', fontSize: 14, fontWeight: '500' },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center' },
  panel: { borderRadius: 32, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.25)' },
  close: { position: 'absolute', top: 16, right: 16, zIndex: 2, width: 32, height: 32, borderRadius: 16, backgroundColor: GLASS, alignItems: 'center', justifyContent: 'center' },
  body: { padding: 24, gap: 14 },
  columns: { flexDirection: 'row', gap: 14, alignItems: 'stretch' },
  now: { minWidth: 240, paddingRight: 8 },
  place: { color: '#fff', fontSize: 20, fontWeight: '600' },
  updated: { color: 'rgba(255,255,255,0.6)', fontSize: 13, marginTop: 2 },
  temp: { color: '#fff', fontSize: 88, fontWeight: '200', letterSpacing: -3, fontVariant: ['tabular-nums'] },
  label: { color: '#fff', fontSize: 20, fontWeight: '500' },
  hilo: { color: 'rgba(255,255,255,0.85)', fontSize: 16, fontWeight: '500', marginTop: 4 },
  section: { backgroundColor: GLASS, borderRadius: 18, padding: 14, gap: 10 },
  caption: { color: 'rgba(255,255,255,0.6)', fontSize: 12, fontWeight: '600', letterSpacing: 0.6 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignContent: 'flex-start' },
  tile: { backgroundColor: GLASS, borderRadius: 16, padding: 12, gap: 4, minHeight: 86 },
  value: { color: '#fff', fontSize: 24, fontWeight: '500', fontVariant: ['tabular-nums'] },
  unit: { fontSize: 14, fontWeight: '500', color: 'rgba(255,255,255,0.75)' },
  note: { color: 'rgba(255,255,255,0.7)', fontSize: 12 },
  hours: { gap: 4 },
  hour: { width: 56, alignItems: 'center', gap: 8, paddingVertical: 4 },
  hourTime: { color: 'rgba(255,255,255,0.85)', fontSize: 13, fontWeight: '600' },
  hourTemp: { color: '#fff', fontSize: 17, fontWeight: '600' },
  rain: { color: '#7FD3FF', fontSize: 11, fontWeight: '700' },
  segment: { position: 'absolute', height: 3, borderRadius: 1.5, backgroundColor: '#FFD36B' },
  mark: { position: 'absolute', width: 48, alignItems: 'center', gap: 4 },
  markTemp: { color: '#fff', fontSize: 13, fontWeight: '600' },
  markTime: { position: 'absolute', width: 48, textAlign: 'center', color: 'rgba(255,255,255,0.7)', fontSize: 12 },
  dot: { width: 9, height: 9, borderRadius: 4.5, backgroundColor: '#fff' },
  days: { gap: 2 },
  day: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 5 },
  dayName: { width: 52, color: '#fff', fontSize: 16, fontWeight: '600' },
  dayIcon: { width: 40, alignItems: 'center' },
  dayLow: { width: 46, textAlign: 'right', color: 'rgba(255,255,255,0.6)', fontSize: 16, fontWeight: '500' },
  dayHigh: { width: 46, color: '#fff', fontSize: 16, fontWeight: '600' },
  range: { flex: 1, height: 5, borderRadius: 3, backgroundColor: 'rgba(0,0,0,0.25)' },
  rangeFill: { position: 'absolute', top: 0, bottom: 0, borderRadius: 3, backgroundColor: '#FFC24B' },
  attribution: { color: 'rgba(255,255,255,0.5)', fontSize: 11, textAlign: 'center' },
});
