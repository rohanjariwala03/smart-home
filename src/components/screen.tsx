import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, Spacing } from '@/constants/theme';
import { useHA, type Status } from '@/ha';

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
              <ThemedText type="subtitle">{title}</ThemedText>
              {subtitle && <ThemedText themeColor="textSecondary">{subtitle}</ThemedText>}
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

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  content: { padding: Spacing.three, gap: Spacing.three, paddingBottom: BottomTabInset + Spacing.three },
  banner: { padding: Spacing.three, borderRadius: 12 },
  card: { padding: Spacing.three, borderRadius: 16, gap: Spacing.two },
  dim: { opacity: 0.45 },
});
