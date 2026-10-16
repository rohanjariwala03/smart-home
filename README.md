# Smart Home

Personal iPhone app (Expo / React Native) for the house: Govee TV lights, Kasa switches, Blink Outdoor 4 + Video Doorbell. Home Assistant does all device integration; Alexa keeps working independently.

```
iPhone app ──WebSocket──▶ Home Assistant ──▶ TP-Link (Kasa), Matter (Govee)
          └─HTTP (HLS)──▶ Blink Live View Proxy integration ──▶ proxy add-on ──▶ Blink cloud
```

## Run

```bash
npm install
npx expo run:ios --device --configuration Release   # standalone build on a USB/Wi-Fi-paired iPhone
```

Expo Go can't run this app because of the widget extension and secure store.

In the app's **Settings** tab enter the Home Assistant URL (e.g. `http://192.168.2.79`, no port on this install) and a long-lived token. The phone must be on the home Wi-Fi.

Before you finish a change, run `npx tsc --noEmit` and `npx expo lint`.

## Home Assistant requirements

| Device | Integration |
|---|---|
| Kasa switches | TP-Link Smart Home (built in) |
| Govee TV Backlight 3 Lite (H6099) | Matter (built in). The model has no Govee LAN Control; pair it with a code from the Govee app |
| Blink cameras | [Blink Live View Proxy](https://github.com/Teethree89/ha-blink-live-view-proxy) add-on + integration (replaces the official Blink integration) |
| Scenes | Created in HA (Settings → Automations & scenes → Scenes) |

Create the token under Profile → Security → Long-lived access tokens. Adding devices from the app needs an **admin** user's token. If you only need control, a non-admin user is safer.

## Code map

- `src/ha.tsx`: HA connection (via `home-assistant-js-websocket`: auth, reconnect, resubscribe), live entity map, `call()` for services. The UI only changes state when HA reports it; there is no optimistic UI.
- `src/app/index.tsx` + `src/favourites.tsx` + `components/favourites-sheet.tsx`: Home shows only starred cameras, scenes and devices (ids kept on the phone in the Keychain). Star from Edit on Home, a device's sheet, or a camera card.
- `src/app/devices.tsx` + `components/device-tile.tsx`: every device grouped by HA area as 2-column tiles, then scenes. Tap a tile to toggle it (vacuums start or pause). Hold any tile to open `components/device-sheet.tsx`, which has the controls (light brightness, warmth and colour; vacuum dock, find, suction and Shark rooms), schedules, and the device's other HA entities (energy, LED, firmware). Also All off.
- `targets/widget/Widget.swift`: the home-screen widget (small, medium, large), the Lock Screen widget (first picked device), and a Control Center toggle (iOS 18; it can also replace the Lock Screen torch or camera button). Taps run App Intents that call HA's REST API from the extension. It reads the creds the app copies to the shared keychain group (`shareWithWidget` in `src/ha.tsx`). It refreshes every 15 minutes and after each tap.
- `targets/widget/_shared/Home.swift`: the HA REST client and the App Intents, compiled into both the app and the widget. Siri and Shortcuts use them: "Turn off <device> for an hour in Smart Home" creates the same `smarthome_timer_*` automation as the app. "Show Front Door in Smart Home" opens that camera's live view. `plugins/with-app-shortcuts.js` registers device names with Siri at launch and raises the app to iOS 18 (`OpenURLIntent`).
- `plugins/with-scene-lifecycle.js`: the iOS 27 SDK requires the UIScene lifecycle, and Expo 57's template doesn't use it yet.
- `src/app/cameras.tsx`: Blink snapshots, motion, motion-detection and arm toggles, live view. `smarthome://cameras?live=<slug>` opens a camera's live view; motion and doorbell alerts link there.
- `src/components/live-view.tsx`: gets a 10-minute camera token from the proxy integration, plays the integration's HLS stream (`/hls/index.m3u8?token=`) in a native expo-video player with the app's own controls, and stops the session on close or background. Hold the mic button to talk: `modules/mic-stream` (local Expo module, Swift) streams the mic as 16-bit PCM to the proxy's `/ptt` WebSocket on the same live-view session.
- Live view also has camera settings (night vision, flood light, speaker volume, as the model allows; the proxy's `/controls`), Record (saves the proxy's copy of the live view, `/last-liveview.mp4`), and full screen. `src/orientation.ts`: the app stays portrait; video screens unlock rotation while open (expo-screen-orientation).
- `src/components/clips.tsx`: the last 30 days of motion clips (Sync Module + Blink cloud) from the proxy's `/clips` API. Play them, or save/share them through the iOS share sheet.
- `components/scene-list.tsx` (on the Devices tab) + `src/scenes.ts` + `components/scene-editor.tsx`: run any HA scene or script, and make your own. App scenes are HA scripts (`script.smarthome_scene_*`: on/off, brightness, colour), so Siri, widgets and the watch can run them. Their Govee scenes ride in the script's variables and are applied by the app.
- `src/app/status.tsx` + `components/energy-card.tsx`: health (HA connection, version and updates, Blink connections and last poll, offline devices, batteries), a per-camera health card (battery, Wi-Fi, temperature, motion detection, last clip), and energy (live W, daily kWh from HA statistics) for devices that measure it. Its switch creates `smarthome_health`, a phone alert whose watch list re-saves itself when devices change.
- `components/camera-automations.tsx`: on the Cameras tab, arm at night / disarm in the morning (`smarthome_night_*`), arm when everyone leaves / disarm on return (`smarthome_leave_*`, `smarthome_arrive_*`, from `zone.home`'s count of people home), and motion turns on lights (`smarthome_motionlight_*`).
- `targets/watch/`: Apple Watch app (SwiftUI): camera snapshots with the doorbell first, device toggles, scenes. It calls HA's REST API from the watch. `_shared/WatchSync.swift` (also in the phone app) hands it the URL + token over WatchConnectivity. It needs the iPhone nearby on home Wi-Fi.
- `src/app/settings.tsx`: URL + token (iOS Keychain via `expo-secure-store`) and diagnostics.
- `src/schedules.ts` + `components/schedule-card.tsx`: schedules (time or sunrise/sunset, weekdays) and auto-off. These are stored as plain HA automations with ids `smarthome_*`, so they run on the hub with the phone off and can also be edited in HA. Needs an admin token.
- `src/govee.tsx`: optional Govee cloud API key (Settings) for scenes, music mode and DreamView, which Matter doesn't expose.
- `src/automations.ts` + `components/device-extras.tsx`: fixed-id automations: timers (`smarthome_timer_*`, one-shot, they disable themselves), away mode (`smarthome_away_*`) and camera motion alerts to the HA companion app (`smarthome_alert_*`). Also the device screen's activity history (HA `history/history_during_period`) and name & room editing (registry updates; admin).
- `components/live-grid.tsx` + `components/camera-strip.tsx`: all cameras live at once (each its own proxy session, via `useLiveStream`), and the dashboard's camera row.
- `components/announce-settings.tsx` (Settings › Announcements): Echo announcements through Alexa Media Player (HACS) for the doorbell, camera motion and health problems, with quiet hours. They're one automation, `smarthome_announce`, calling `notify.alexa_media` with `type: announce`. Also how to turn on Siri's Announce Notifications for the HA companion app on AirPods/CarPlay.
- `src/setup.ts` + `src/components/add-device.tsx`: add devices without the HA app. They use HA's config-flow API to list what HA discovered on the network, add any integration by brand (rendering HA's own setup forms), and pair Matter devices with a code over Wi-Fi. Needs an admin token. Brand-new Matter devices still pair over Bluetooth in the HA app.

Devices are listed by domain, not by hard-coded entity IDs. Anything added in HA shows up automatically.

## Security

- Away from home: the Tailscale add-on (`a0d7b954_tailscale`) advertises the subnet route `192.168.2.79/32` (approved, key expiry off), so the app keeps using `http://192.168.2.79`. The iPhone runs the Tailscale app with VPN On Demand. Never port-forward Home Assistant or the proxy.
- The token is a bearer credential for the house, cameras included. It is stored only in the Keychain and never logged.
- Blink credentials live in the proxy add-on, never in the app.
- Push-to-talk in the live player needs HTTPS; on a plain `http://` URL it is unavailable.
