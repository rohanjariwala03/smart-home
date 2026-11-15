import { DarkTheme, DefaultTheme, router, ThemeProvider } from 'expo-router';
import * as ScreenOrientation from 'expo-screen-orientation';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { Appearance, useColorScheme } from 'react-native';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import AppTabs from '@/components/app-tabs';
import { HalloweenSounds } from '@/components/halloween';
import { HAProvider, useHA } from '@/ha';
import { isPad } from '@/orientation';
import { Push } from '@/push';

SplashScreen.preventAutoHideAsync();
// Always dark for now, whatever the iPhone or iPad is set to (native sheets and pickers too).
Appearance.setColorScheme('dark');
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
        <FirstRun />
        {isPad && <HalloweenSounds />}
      </HAProvider>
    </ThemeProvider>
  );
}

/** Nothing to show until Home Assistant is set up: open Settings, where the app is already looking for it. */
function FirstRun() {
  const { status } = useHA();
  useEffect(() => {
    if (status === 'no-config') setTimeout(() => router.navigate('/settings'));
  }, [status]);
  return null;
}
