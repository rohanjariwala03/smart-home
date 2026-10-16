import * as ScreenOrientation from 'expo-screen-orientation';
import { useEffect } from 'react';

// The app is portrait; video screens may turn sideways while they're open.
export const lockPortrait = () => ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
export const lockLandscape = () => ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE);

export function useRotation() {
  useEffect(() => {
    ScreenOrientation.unlockAsync();
    return () => void lockPortrait();
  }, []);
}
