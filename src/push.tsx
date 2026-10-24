import * as Device from 'expo-device';
import { fetch } from 'expo/fetch';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Alert } from 'react-native';

import { byDomain, unavailable, useHA } from '@/ha';

// Alerts sent by Home Assistant straight to Apple (homeassistant/custom_components/smarthome_push), as
// notify.smart_home_app. The app hands Home Assistant its APNs token; tapping an alert opens its `url`. Camera
// alerts carry buttons: Live view, Snooze 1 hour (that camera, held back in Home Assistant), Disarm cameras.
// Each opens the app for a moment: on iOS, Expo runs no app code for a button tapped in the background.

const SNOOZE_MINUTES = 60;

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});
// The buttons of the category Home Assistant sets on alerts with a live view to open.
Notifications.setNotificationCategoryAsync('camera', [
  { identifier: 'live', buttonTitle: 'Live view', options: { opensAppToForeground: true } },
  { identifier: 'snooze', buttonTitle: 'Snooze 1 hour', options: { opensAppToForeground: true } },
  {
    identifier: 'disarm',
    buttonTitle: 'Disarm cameras',
    options: { opensAppToForeground: true, isAuthenticationRequired: true, isDestructive: true },
  },
]).catch(() => {});

type Extra = { url?: string; live?: string; tag?: string; group?: string };

const extra = (response: Notifications.NotificationResponse): Extra => {
  const { content, trigger } = response.notification.request;
  // expo-notifications passes the payload's "body" dictionary as data; the raw payload is a fallback.
  const raw = trigger && 'payload' in trigger ? (trigger.payload as { body?: Extra } | null)?.body : undefined;
  return { ...raw, ...(content.data as Extra) };
};

const go = (target?: string) => {
  if (target?.startsWith('smarthome://')) router.push(target.replace('smarthome://', '/') as never);
};

/** Registers this phone with Home Assistant and acts on a tapped alert or its buttons. */
export function Push() {
  const { creds, call, entities, status } = useHA();
  const last = Notifications.useLastNotificationResponse();
  const handled = useRef<string>(undefined);

  useEffect(() => {
    if (!creds || !Device.isDevice) return;
    (async () => {
      const { granted } = await Notifications.requestPermissionsAsync();
      if (!granted) return;
      const { data: token } = await Notifications.getDevicePushTokenAsync();
      // Every launch: Apple can change the token, and Home Assistant drops ones Apple rejects.
      await fetch(`${creds.url}/api/smarthome_push/devices`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${creds.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, name: Device.deviceName ?? 'iPhone' }),
      });
    })().catch(() => {}); // not set up in Home Assistant yet, or offline: alerts keep going wherever they went
  }, [creds]);

  useEffect(() => {
    // Also covers the tap that launched the app. Buttons wait for the connection; each response runs once.
    if (!last || status !== 'ready') return;
    const id = `${last.notification.request.identifier}:${last.actionIdentifier}`;
    if (handled.current === id) return;
    handled.current = id;
    const { url, live, tag } = extra(last);
    const title = last.notification.request.content.title ?? 'Camera';
    const done = (ok: boolean, text: string) => ok && Alert.alert(text); // `call` reports failures itself
    if (last.actionIdentifier === 'live') go(live);
    else if (last.actionIdentifier === 'snooze' && tag) {
      const until = new Date(Date.now() + SNOOZE_MINUTES * 60_000).toLocaleTimeString([], { timeStyle: 'short' });
      call('smarthome_push', 'snooze', { key: tag, minutes: SNOOZE_MINUTES }).then((ok) =>
        done(ok, `${title} alerts snoozed until ${until}.`),
      );
    } else if (last.actionIdentifier === 'disarm') {
      const alarms = byDomain(entities, 'alarm_control_panel').filter((e) => !unavailable(e));
      call('alarm_control_panel', 'alarm_disarm', { entity_id: alarms.map((e) => e.entity_id) }).then((ok) =>
        done(ok, 'Cameras disarmed.'),
      );
    } else go(url);
  }, [last, status, call, entities]);

  return null;
}
