import * as Haptics from 'expo-haptics';
import { SymbolView, type SFSymbol } from 'expo-symbols';
import { Pressable, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';

export function Chip({ icon, label, selected, disabled, onPress }: {
  icon?: SFSymbol;
  label: string;
  selected?: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  const fg = selected ? theme.background : theme.text;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected, disabled }}
      disabled={disabled}
      onPress={() => {
        Haptics.selectionAsync();
        onPress();
      }}
      style={({ pressed }) => [
        styles.chip,
        { backgroundColor: selected ? theme.text : theme.backgroundSelected },
        disabled && styles.dim,
        pressed && styles.pressed,
      ]}>
      {icon && <SymbolView name={icon} size={14} tintColor={fg} />}
      <ThemedText type="small" style={[styles.label, { color: fg }]}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
  },
  label: { fontWeight: '600' },
  dim: { opacity: 0.45 },
  pressed: { opacity: 0.7, transform: [{ scale: 0.97 }] },
});
