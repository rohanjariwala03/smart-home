// Siri only recognises device names in App Shortcut phrases ("Turn off <device> in Smart Home")
// after the app hands it the current list (targets/widget/_shared/Home.swift), so do that at launch.
// Also raises the app to iOS 18 for OpenURLIntent ("Show Front Door in Smart Home").
const { withAppDelegate, withXcodeProject } = require('expo/config-plugins');

// Also starts the link that hands the HA URL + token to the watch app (targets/watch/_shared/WatchSync.swift), and
// hands Home Assistant the doorbell Live Activity's push tokens (targets/widget/_shared/Doorbell.swift).
const LINES = ['SmartHomeShortcuts.updateAppShortcutParameters()', 'WatchSync.shared.start()', 'DoorbellActivity.start()'];
const CALL = LINES.map((l) => `    ${l}\n`).join('');
const ANCHOR = '    return super.application(application, didFinishLaunchingWithOptions: launchOptions)';

const withIOS18 = (config) =>
  withXcodeProject(config, (c) => {
    const configs = c.modResults.pbxXCBuildConfigurationSection();
    for (const { buildSettings: b } of Object.values(configs)) {
      if (parseFloat(b?.IPHONEOS_DEPLOYMENT_TARGET) < 18) b.IPHONEOS_DEPLOYMENT_TARGET = '18.0';
    }
    return c;
  });

module.exports = (config) =>
  withAppDelegate(withIOS18(config), (c) => {
    // Drop the lines an earlier version added, then add the current set once.
    const src = c.modResults.contents
      .split('\n')
      .filter((l) => !LINES.includes(l.trim()))
      .join('\n');
    if (!src.includes(ANCHOR)) throw new Error(`with-app-shortcuts: AppDelegate template changed, can't find:\n${ANCHOR}`);
    c.modResults.contents = src.replace(ANCHOR, CALL + ANCHOR);
    return c;
  });
