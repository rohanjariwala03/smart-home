import { DarkTheme, DefaultTheme, ThemeProvider } from 'expo-router';
import * as ScreenOrientation from 'expo-screen-orientation';
import * as SplashScreen from 'expo-splash-screen';
import { useColorScheme } from 'react-native';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import AppTabs from '@/components/app-tabs';
import { HalloweenSounds } from '@/components/halloween';
import { HAProvider } from '@/ha';
import { isPad } from '@/orientation';
import { Push } from '@/push';

SplashScreen.preventAutoHideAsync();
// The phone starts portrait; an iPad turns freely (it may hang on a wall sideways).
if (isPad) ScreenOrientation.unlockAsync();

export default function TabLayout() {
  const colorScheme = useColorScheme();
  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <AnimatedSplashOverlay />
      <HAProvider>
        <AppTabs />
        <Push />
        {isPad && <HalloweenSounds />}
      </HAProvider>
    </ThemeProvider>
  );
}
