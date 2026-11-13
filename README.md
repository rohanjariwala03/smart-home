# Smart Home

Personal iPhone app (Expo SDK 57 / React Native) for the house: Govee TV lights, Kasa switches, TVs, Echo speakers, and Blink Outdoor 4 cameras plus the Video Doorbell. Home Assistant does all device integration; Alexa keeps working independently. There's also a home-screen widget, a Control Center toggle, Siri intents and an Apple Watch app.

```
iPhone app ──WebSocket──▶ Home Assistant ──▶ TP-Link (Kasa), Matter (Govee), Alexa Media Player, ...
          └─HTTP (HLS)──▶ Blink Instant Events integration ──▶ Blink cloud
```

## The app

Five tabs:

- Home: only your favourites (starred cameras, scenes and devices), in the order you set under Edit.
- Devices: every device grouped by Home Assistant area, then scenes, plus All off. Tap a tile's icon to switch it; tap the rest of the tile for its settings sheet.
- Cameras: Blink snapshots, live view, clips, arming and camera automations.
- Status: HA, Blink and per-camera health, offline devices, batteries, and energy use.
- Settings: add or remove devices, Echo announcements, the HA address and token, and an optional Govee cloud key.

Devices are listed by domain, not by hard-coded entity IDs. Anything added in HA shows up automatically.

## Run

```bash
npm install
npx expo run:ios --device --configuration Release   # standalone build on a USB/Wi-Fi-paired iPhone
```

Expo Go can't run this app because of the widget and watch targets, the local `mic-stream` native module and secure store. The `ios/` folder is generated; native changes go in `app.json` and `plugins/`.

In the app's Settings tab, open Address & token and enter the Home Assistant URL (for example `http://192.168.x.x`) and a long-lived token. The phone must be on the home Wi-Fi (or on Tailscale, see Security).

There are no tests. Before you finish a change, run `npx tsc --noEmit` and `npx expo lint`.

## Home Assistant requirements

| Device | Integration |
|---|---|
| Kasa switches | TP-Link Smart Home (built in) |
| Govee TV Backlight 3 Lite (H6099) | Matter (built in). The model has no Govee LAN Control; pair it with a code from the Govee app. Lights from HA's Govee integration also work |
| Blink cameras | [Local Camera Vision](https://github.com/rohanjariwala03/ha-local-camera-vision) (formerly Blink Instant Events; HACS, replaces the official Blink integration) |
| Echo speakers, announcements | Alexa Media Player (HACS) |
| Scenes | Created in HA (Settings › Automations & scenes › Scenes) or in the app |

Create the token under Profile › Security › Long-lived access tokens. Adding, removing or renaming devices, schedules and automations need an admin user's token. If you only need control, a non-admin user is safer.

## Code map

- `src/ha.tsx`: HA connection (via `home-assistant-js-websocket`: auth, reconnect, resubscribe), live entity and device registry, `call()` for services (resolves `false` on failure). Also decides what counts as a device: a switch on a camera, speaker, TV, light or fan (an Echo's Do Not Disturb, a Govee light's music mode) is a setting of that device, not a tile.
- `src/optimistic.ts`: switches and tiles flip the moment they're tapped and hold until HA reports the change (or 15 s), snapping back with an error buzz if the call fails.
- `src/app/index.tsx` + `src/favourites.tsx` + `components/favourites-sheet.tsx`: Home's favourites, kept in the Keychain. Edit opens a native SwiftUI list (drag to reorder). A copy in the shared keychain (`ha-favourites`) drives the widget when it isn't configured, puts favourites first in Siri's and Control Center's device lists, and goes to the watch.
- `src/app/devices.tsx` + `components/device-tile.tsx` + `components/device-sheet.tsx`: the Devices tab. Vacuums start or pause from the tile; an Echo plays or pauses. The sheet has the controls (light brightness, warmth and colour; vacuum dock, find and suction; TV power, volume, playback and input; Echo volume), rename, timers, schedules, other HA entities, alert switches, and Remove device.
- `components/device-extras.tsx` + `src/automations.ts`: fixed-id automations stored in HA, so they run with the phone off: timers (`smarthome_timer_*`, one-shot), away mode (`smarthome_away_*`), "When this turns on, also turn on…" (`smarthome_follow_*`, optionally only after dark), camera motion alerts (`smarthome_alert_*`), health alerts (`smarthome_health`) and announcements (`smarthome_announce`). Also activity history (HA `history/history_during_period`) and name & room editing.
- `src/schedules.ts` + `components/schedule-card.tsx`: schedules (time or sunrise/sunset, weekdays) and auto-off, saved as plain HA automations with `smarthome_*` ids, so they can also be edited in HA.
- `components/scene-list.tsx` + `src/scenes.ts` + `components/scene-editor.tsx`: run any HA scene or script, and make your own. App scenes are HA scripts (`script.smarthome_scene_*`), so Siri, widgets and the watch can run them. They can include TVs; Govee scenes ride in the script's variables and are applied by the app.
- `src/govee.tsx`: optional Govee cloud API key for scenes, music mode and DreamView on Matter-added Govee lights, which Matter doesn't expose.
- `src/app/cameras.tsx` + `components/camera-automations.tsx`: snapshots, motion, arming, per-camera alert switches, and automatic arming: at night (`smarthome_night_*`), when everyone leaves or returns (`smarthome_leave_*`, `smarthome_arrive_*`, from `zone.home`), and motion turns on lights (`smarthome_motionlight_*`). `smarthome://cameras?live=<slug>` opens a camera's live view; motion and doorbell alerts link there.
- `src/components/live-view.tsx`: gets a 10-minute token from Blink Instant Events (`/api/blink_instant_events/cameras/<slug>`) and plays its HLS stream (`/hls/index.m3u8`) in expo-video with the app's own controls. Hold the mic to talk: `modules/mic-stream` (local Expo module, Swift) streams 16-bit PCM to its `/ptt` WebSocket. Also camera settings (`/controls`), Record (`/last-liveview.mp4`) and full screen. `src/orientation.ts` keeps the app portrait and unlocks rotation on video screens.
- `components/clips.tsx`: the last 30 days of motion clips from the `/api/blink_instant_events/clips` API, to play or share.
- `components/live-grid.tsx` + `components/camera-strip.tsx`: all cameras live at once, and the camera row on Home.
- `src/app/status.tsx` + `components/energy-card.tsx`: health (HA version and updates, Blink connection and last poll, offline devices, batteries), per-camera health, and energy (live W, daily kWh from HA statistics). Its switch turns on the `smarthome_health` phone alert; each device can be muted from its sheet.
- `components/announce-settings.tsx`: Echo announcements for the doorbell, camera motion and home problems, with quiet hours. Each camera and device has its own Announce on Echo switch (on by default). The card lists anything that would stop an alert from being spoken, with one-tap fixes.
- `src/setup.ts` + `components/add-device.tsx` + `components/remove-devices.tsx`: add devices without the HA app (HA's discovered list, any integration by brand using HA's own setup forms, Matter pairing code over Wi-Fi) and remove them. Integrations that can't delete a device get it disabled instead. Brand-new Matter devices still pair over Bluetooth in the HA app.
- `targets/widget/Widget.swift`: home-screen widget (small, medium, large), Lock Screen widget, and a Control Center toggle (iOS 18). Taps run App Intents that call HA's REST API with the creds the app copies to the shared keychain group. Refreshes every 15 minutes and after each tap.
- `targets/widget/_shared/Home.swift`: the HA REST client and App Intents, compiled into both the app and the widget. Siri and Shortcuts use them ("Turn off <device> for an hour in Smart Home"). `plugins/with-app-shortcuts.js` registers device names with Siri at launch.
- `targets/watch/`: Apple Watch app (SwiftUI): camera snapshots with the doorbell first, device toggles, scenes, calling HA's REST API. `_shared/WatchSync.swift` hands it the URL, token and favourites over WatchConnectivity. It needs the iPhone nearby on home Wi-Fi.
- `plugins/with-scene-lifecycle.js`: the iOS 27 SDK requires the UIScene lifecycle, and Expo 57's template doesn't use it yet.

## Hub watchdog

Home Assistant runs in a UTM VM on a Mac. `scripts/hub-watchdog.sh` runs every 2 minutes from the LaunchAgent in `scripts/com.smarthome.hub-watchdog.plist`. On the home network it starts the VM if it isn't running, restarts it after about 6 minutes of HA not answering (at most once per 20 minutes), and copies HA's newest backup to `~/Home Assistant Backups`, keeping 7. The VM id, addresses and script path are hard-coded for this Mac; change them before using it elsewhere. To install:

```bash
cp scripts/com.smarthome.hub-watchdog.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.smarthome.hub-watchdog.plist
```

## Security

- Away from home: the Tailscale add-on advertises a subnet route for the HA host's LAN address (`/32`, approved, key expiry off), so the app keeps using the same `http://` URL. The iPhone runs the Tailscale app with VPN On Demand. Never port-forward Home Assistant.
- The token is a bearer credential for the house, cameras included. It is stored only in the Keychain and never logged.
- Blink credentials live in the Blink Instant Events integration in HA, never in the app.

## Recent changes

October 2026

- Home shows only favourites; all devices moved to a new Devices tab. Widgets, Siri, Control Center and the watch follow the same favourites.
- Switches respond instantly and snap back if HA rejects the change. Live view got pinch to zoom and controls that hide themselves.
- TVs show up as devices, Echos as speakers, and any device can turn others on with it ("When this turns on, also turn on…").
- Echo announcements and phone problem alerts can be muted per device, and the Announcements card says why an alert wouldn't be spoken.
- Devices can be removed from their sheet or from Settings. Lights from HA's Govee integration now show music mode as a setting and scenes as a picker.
- Added the hub watchdog for the Mac that runs Home Assistant.

## License

MIT, see [LICENSE](LICENSE).
