import { SymbolView, type SFSymbol } from 'expo-symbols';
import { useEffect, useState, type ReactNode, type Ref } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Chip } from '@/components/chip';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, Spacing } from '@/constants/theme';
import { useHA, type Status } from '@/ha';
import { useTheme } from '@/hooks/use-theme';

const BANNER: Partial<Record<Status, string>> = {
  'no-config': 'Not set up yet: connect to your Home Assistant under Settings.',
  connecting: 'Connecting to Home Assistant…',
  disconnected: 'Disconnected. Reconnecting; states below may be stale.',
  error: 'Connection failed. Check Settings.',
};

/** `readable` keeps lists of text (Status, Settings) to a comfortable width on an iPad, centred. */
export function Screen({ title, subtitle, action, readable, scrollRef, children }: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  readable?: boolean;
  scrollRef?: Ref<ScrollView>;
  children: ReactNode;
}) {
  const { status, error } = useHA();
  const offline = useOffline(status, error);
  const banner = offline ? undefined : BANNER[status];

  return (
    <ThemedView style={styles.flex}>
      <SafeAreaView style={styles.flex} edges={['top']}>
        <ScrollView ref={scrollRef} contentContainerStyle={[styles.content, readable && styles.readable]}>
          <View style={styles.header}>
            <View style={styles.flex}>
              <ThemedText style={styles.title} maxFontSizeMultiplier={1.3}>
                {title}
              </ThemedText>
              {subtitle && <ThemedText type="small" themeColor="textSecondary">{subtitle}</ThemedText>}
            </View>
            {action}
          </View>
          {offline && <HubOffline />}
          {banner && (
            <ThemedView type="backgroundSelected" style={styles.banner}>
              <ThemedText type="small">{banner}</ThemedText>
            </ThemedView>
          )}
          {children}
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

// The devices' own apps, which work while the hub is offline. App Store ids; the URL schemes open the app when
// it's installed, otherwise its App Store page (which has an Open button).
const APPS: [label: string, icon: SFSymbol, scheme: string, id: number][] = [
  ['Kasa', 'lightswitch.on', 'kasa://', 1034035493],
  ['Blink', 'video.fill', 'blink://', 1013961111],
  ['Govee', 'lightbulb.led.fill', 'govee://', 1395696823],
  ['Alexa', 'homepod.fill', 'alexa://', 944011620],
];

/** Hub unreachable (not a wrong token), or disconnected for over 10 s: brief network blips don't count. */
function useOffline(status: Status, error?: string) {
  const [long, setLong] = useState(false);
  useEffect(() => {
    if (status !== 'disconnected') return;
    const t = setTimeout(() => setLong(true), 10_000);
    return () => {
      clearTimeout(t);
      setLong(false);
    };
  }, [status]);
  return (status === 'error' && error !== 'Invalid token') || long;
}

function HubOffline() {
  return (
    <ThemedView type="backgroundElement" style={styles.card}>
      <View style={styles.header}>
        <SymbolView name="wifi.exclamationmark" size={20} tintColor="#FF9F0A" />
        <ThemedText type="smallBold" style={styles.flex}>Hub offline</ThemedText>
      </View>
      <ThemedText type="small" themeColor="textSecondary">
        Home Assistant runs on your MacBook, so it can’t be reached while the Mac is asleep, shut down or away from
        home Wi-Fi. What you see may be out of date, and app schedules, alerts and announcements are paused. Kasa
        schedules and Alexa keep working. Reconnecting by itself.
      </ThemedText>
      <View style={styles.apps}>
        {APPS.map(([label, icon, scheme, id]) => (
          <Chip
            key={label}
            icon={icon}
            label={label}
            onPress={() => Linking.openURL(scheme).catch(() => Linking.openURL(`https://apps.apple.com/app/id${id}`))}
          />
        ))}
      </View>
    </ThemedView>
  );
}

export function Card({ children, dim }: { children: ReactNode; dim?: boolean }) {
  return (
    <ThemedView type="backgroundElement" style={[styles.card, dim && styles.dim]}>
      {children}
    </ThemedView>
  );
}

/** A row that opens to show settings you don't need every day. `summary` shows what's on while closed. */
export function Disclosure({ title, summary, initiallyOpen, children }: {
  title: string;
  summary?: string;
  initiallyOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(!!initiallyOpen);
  const theme = useTheme();
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        hitSlop={6}
        onPress={() => setOpen(!open)}
        style={({ pressed }) => [styles.header, styles.disclosure, pressed && styles.pressed]}>
        <ThemedText style={styles.flex}>{title}</ThemedText>
        {summary && !open && (
          <ThemedText type="small" themeColor="textSecondary" numberOfLines={1} style={styles.summary}>
            {summary}
          </ThemedText>
        )}
        <SymbolView name={open ? 'chevron.up' : 'chevron.down'} size={14} tintColor={theme.textSecondary} />
      </Pressable>
      {open && children}
    </>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  title: { fontSize: 34, lineHeight: 41, fontWeight: '700', letterSpacing: 0.4 },
  disclosure: { paddingVertical: Spacing.one },
  summary: { flexShrink: 1 },
  pressed: { opacity: 0.6 },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  content: { padding: Spacing.three, gap: Spacing.four, paddingBottom: BottomTabInset + Spacing.three },
  readable: { width: '100%', maxWidth: 720, alignSelf: 'center' },
  banner: { padding: Spacing.three, borderRadius: 12 },
  card: { padding: Spacing.three, borderRadius: 14, gap: Spacing.two },
  dim: { opacity: 0.45 },
  apps: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
});
