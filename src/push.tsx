import * as Device from 'expo-device';
import { fetch } from 'expo/fetch';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { useEffect } from 'react';

import { useHA } from '@/ha';

// Alerts sent by Home Assistant straight to Apple (homeassistant/custom_components/smarthome_push), as
// notify.smart_home_app. The app hands Home Assistant its APNs token; tapping an alert opens its `url`, its
// Live view button the camera's live view.

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});
// The button on camera alerts (the category Home Assistant sets when there's a live view to open).
Notifications.setNotificationCategoryAsync('camera', [
  { identifier: 'live', buttonTitle: 'Live view', options: { opensAppToForeground: true } },
]).catch(() => {});

type Extra = { url?: string; live?: string };

const extra = (response: Notifications.NotificationResponse): Extra => {
  const { content, trigger } = response.notification.request;
  // expo-notifications passes the payload's "body" dictionary as data; the raw payload is a fallback.
  const raw = trigger && 'payload' in trigger ? (trigger.payload as { body?: Extra } | null)?.body : undefined;
  return { ...raw, ...(content.data as Extra) };
};

const open = (response: Notifications.NotificationResponse) => {
  const { url, live } = extra(response);
  const target = response.actionIdentifier === 'live' ? live : url;
  if (target?.startsWith('smarthome://')) router.push(target.replace('smarthome://', '/') as never);
};

/** Registers this phone with Home Assistant and opens what a tapped alert points at. */
export function Push() {
  const { creds } = useHA();
  const last = Notifications.useLastNotificationResponse();

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
    if (last) open(last); // also covers the tap that launched the app
  }, [last]);

  return null;
}
