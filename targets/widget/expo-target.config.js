/** @type {import('@bacons/apple-targets/app.plugin').ConfigFunction} */
module.exports = (config) => ({
  type: 'widget',
  name: 'SmartHomeWidget',
  displayName: 'Smart Home',
  // Control Center controls need iOS 18 (interactive widgets 17).
  deploymentTarget: '18.0',
  // Same group the app writes the widget's creds into (src/ha.tsx).
  entitlements: { 'keychain-access-groups': config.ios.entitlements['keychain-access-groups'] },
});
