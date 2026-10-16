import * as Haptics from 'expo-haptics';
import type { HassEntity } from 'home-assistant-js-websocket';
import { useState } from 'react';

/**
 * A switch shows its new position the moment it's tapped and keeps it until HA reports this entity changing
 * (Blink takes a few seconds to arm), or 15 s pass. If the command fails it snaps back with an error buzz.
 */
export function useOptimistic(entity: HassEntity, actual: boolean) {
  const [pending, setPending] = useState<{ on: boolean; since: string }>();
  const waiting = pending?.since === entity.last_changed;

  const set = (on: boolean, run: () => Promise<boolean | void> | void) => {
    const mine = { on, since: entity.last_changed };
    setPending(mine);
    const clear = () => setPending((p) => (p === mine ? undefined : p));
    setTimeout(clear, 15000);
    Promise.resolve(run()).then((ok) => {
      if (ok !== false) return;
      clear();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    });
  };

  return { isOn: waiting ? pending.on : actual, waiting, set };
}
