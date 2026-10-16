// iOS 27 SDK kills apps at launch unless they adopt the UIScene life cycle.
// Expo 57 ships ExpoAppSceneDelegate but the prebuild template still starts React Native
// from the app delegate, so switch it over here.
// ponytail: delete this plugin once Expo's template generates the scene-based AppDelegate.
const { withAppDelegate, withInfoPlist } = require('expo/config-plugins');

const replace = (src, from, to) => {
  if (!src.includes(from)) throw new Error(`with-scene-lifecycle: AppDelegate template changed, can't find:\n${from}`);
  return src.replace(from, to);
};

module.exports = (config) => {
  config = withInfoPlist(config, (c) => {
    c.modResults.UIApplicationSceneManifest = {
      UIApplicationSupportsMultipleScenes: false,
      UISceneConfigurations: {
        UIWindowSceneSessionRoleApplication: [
          { UISceneConfigurationName: 'Default Configuration', UISceneDelegateClassName: 'EXExpoAppSceneDelegate' },
        ],
      },
    };
    return c;
  });

  return withAppDelegate(config, (c) => {
    let src = c.modResults.contents;
    if (src.includes('ExpoReactNativeFactoryProvider')) return c;
    src = replace(src, 'class AppDelegate: ExpoAppDelegate {', 'class AppDelegate: ExpoAppDelegate, ExpoReactNativeFactoryProvider {');
    // The scene delegate creates the window and starts React Native.
    src = replace(
      src,
      `    window = UIWindow(frame: UIScreen.main.bounds)
    factory.startReactNative(
      withModuleName: "main",
      in: window,
      launchOptions: launchOptions)
`,
      '',
    );
    c.modResults.contents = src;
    return c;
  });
};
