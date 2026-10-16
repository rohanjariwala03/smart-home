import type { HassEntity } from 'home-assistant-js-websocket';
import { StyleSheet, Switch, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { name, unavailable, useHA } from '@/ha';

// On/off row for any entity. Defaults suit lights and switches (turn_on/turn_off);
// pass isOn/onChange for domains with other services, like alarm panels.
export function Toggle({ entity, label, isOn, onChange }: {
  entity: HassEntity;
  label?: string;
  isOn?: boolean;
  onChange?: (on: boolean) => void;
}) {
  const { call } = useHA();
  const off = unavailable(entity);
  const domain = entity.entity_id.split('.')[0];

  return (
    <View style={styles.row}>
      <View style={styles.flex}>
        <ThemedText>{label ?? name(entity)}</ThemedText>
        {off && <ThemedText type="small" themeColor="textSecondary">Unavailable</ThemedText>}
      </View>
      <Switch
        disabled={off}
        value={isOn ?? entity.state === 'on'}
        onValueChange={
          onChange ?? ((on) => call(domain, on ? 'turn_on' : 'turn_off', { entity_id: entity.entity_id }))
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
});
