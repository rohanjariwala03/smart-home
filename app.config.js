// Your Apple developer team and bundle id come from .env.local (git-ignored), so each person builds under their own:
//   APPLE_TEAM_ID=ABCDE12345
//   BUNDLE_ID=com.yourname.smarthome
const bundle = process.env.BUNDLE_ID;
if (!process.env.APPLE_TEAM_ID || !bundle) throw new Error('Set APPLE_TEAM_ID and BUNDLE_ID in .env.local (see README)');

module.exports = ({ config }) => ({
  ...config,
  ios: {
    ...config.ios,
    bundleIdentifier: bundle,
    appleTeamId: process.env.APPLE_TEAM_ID,
    // Shared with the widget: it reads the Home Assistant address and token from here (src/ha.tsx).
    entitlements: { ...config.ios.entitlements, 'keychain-access-groups': [`$(AppIdentifierPrefix)${bundle}.shared`] },
  },
});
