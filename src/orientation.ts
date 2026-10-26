import * as ScreenOrientation from 'expo-screen-orientation';
import { useEffect } from 'react';
import { Platform } from 'react-native';

export const isPad = Platform.OS === 'ios' && Platform.isPad;

// The phone app is portrait; video screens may turn sideways while they're open. An iPad always turns freely.
export const lockPortrait = () =>
  isPad ? ScreenOrientation.unlockAsync() : ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
export const lockLandscape = () => ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE);

export function useRotation() {
  useEffect(() => {
    ScreenOrientation.unlockAsync();
    return () => void lockPortrait();
  }, []);
}
