import type { HassEntity } from 'home-assistant-js-websocket';
import { StyleSheet, Switch, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { name, unavailable, useHA } from '@/ha';
import { useOptimistic } from '@/optimistic';

// On/off row for any entity. Defaults suit lights and switches (turn_on/turn_off);
// pass isOn/onChange for domains with other services, like alarm panels, and `status` for a line under the label
// (`pending` while HA hasn't confirmed the change yet).
export function Toggle({ entity, label, isOn, onChange, status }: {
  entity: HassEntity;
  label?: string;
  isOn?: boolean;
  onChange?: (on: boolean) => Promise<boolean | void> | void;
  status?: (on: boolean, pending: boolean) => string;
}) {
  const { call } = useHA();
  const off = unavailable(entity);
  const domain = entity.entity_id.split('.')[0];
  const shown = useOptimistic(entity, isOn ?? entity.state === 'on');
  const sub = off ? 'Unavailable' : status?.(shown.isOn, shown.waiting);

  return (
    <View style={styles.row}>
      <View style={styles.flex}>
        <ThemedText>{label ?? name(entity)}</ThemedText>
        {sub && <ThemedText type="small" themeColor="textSecondary">{sub}</ThemedText>}
      </View>
      <Switch
        disabled={off}
        value={shown.isOn}
        onValueChange={(on) =>
          shown.set(on, () =>
            onChange ? onChange(on) : call(domain, on ? 'turn_on' : 'turn_off', { entity_id: entity.entity_id }),
          )
        }
      />
    </View>
  );
}

/** `status` for alarm panels. */
export const armStatus = (on: boolean, pending: boolean) =>
  pending ? (on ? 'Arming…' : 'Disarming…') : on ? 'Armed' : 'Disarmed';

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
});
