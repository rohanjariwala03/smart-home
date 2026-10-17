import { SymbolView } from 'expo-symbols';
import { useState, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, Spacing } from '@/constants/theme';
import { useHA, type Status } from '@/ha';
import { useTheme } from '@/hooks/use-theme';

const BANNER: Partial<Record<Status, string>> = {
  'no-config': 'Not set up. Enter your Home Assistant URL and token in Settings.',
  connecting: 'Connecting to Home Assistant…',
  disconnected: 'Disconnected. Reconnecting; states below may be stale.',
  error: 'Connection failed. Check Settings.',
};

export function Screen({ title, subtitle, action, children }: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  const { status } = useHA();
  const banner = BANNER[status];

  return (
    <ThemedView style={styles.flex}>
      <SafeAreaView style={styles.flex} edges={['top']}>
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.header}>
            <View style={styles.flex}>
              <ThemedText style={styles.title}>{title}</ThemedText>
              {subtitle && <ThemedText type="small" themeColor="textSecondary">{subtitle}</ThemedText>}
            </View>
            {action}
          </View>
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

export function Card({ children, dim }: { children: ReactNode; dim?: boolean }) {
  return (
    <ThemedView type="backgroundElement" style={[styles.card, dim && styles.dim]}>
      {children}
    </ThemedView>
  );
}

/** A row that opens to show settings you don't need every day. `summary` shows what's on while closed. */
export function Disclosure({ title, summary, children }: { title: string; summary?: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
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
  banner: { padding: Spacing.three, borderRadius: 12 },
  card: { padding: Spacing.three, borderRadius: 14, gap: Spacing.two },
  dim: { opacity: 0.45 },
});
