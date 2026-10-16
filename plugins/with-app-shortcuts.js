// Siri only recognises device names in App Shortcut phrases ("Turn off <device> in Smart Home")
// after the app hands it the current list (targets/widget/_shared/Home.swift), so do that at launch.
// Also raises the app to iOS 18 for OpenURLIntent ("Show Front Door in Smart Home").
const { withAppDelegate, withXcodeProject } = require('expo/config-plugins');

// Also starts the link that hands the HA URL + token to the watch app (targets/watch/_shared/WatchSync.swift).
const CALL = '    SmartHomeShortcuts.updateAppShortcutParameters()\n    WatchSync.shared.start()\n';
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
    const src = c.modResults.contents;
    if (src.includes('SmartHomeShortcuts.updateAppShortcutParameters()')) return c;
    if (!src.includes(ANCHOR)) throw new Error(`with-app-shortcuts: AppDelegate template changed, can't find:\n${ANCHOR}`);
    c.modResults.contents = src.replace(ANCHOR, CALL + ANCHOR);
    return c;
  });
