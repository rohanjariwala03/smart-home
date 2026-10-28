import type { SFSymbol } from 'expo-symbols';
import type { HassEntity } from 'home-assistant-js-websocket';
import { useEffect } from 'react';
import {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

// How a device's icon moves while it's on, by what the icon shows (a Kasa switch with the Fan icon spins too):
// fans spin, a TV flickers like a screen, speakers beat, heaters and coffee shimmer, a vacuum wiggles, lights glow.
export type Motion = 'spin' | 'flicker' | 'beat' | 'shimmer' | 'wiggle' | 'glow';

export function motionOf(icon: SFSymbol): Motion | undefined {
  if (/^fan|air\.purifier/.test(icon)) return 'spin';
  if (/^tv/.test(icon)) return 'flicker';
  if (/speaker|homepod/.test(icon)) return 'beat';
  if (/heater|cup|flame/.test(icon)) return 'shimmer';
  if (/vacuum/.test(icon)) return 'wiggle';
  if (/lightbulb|lamp|light\.strip|sparkles|tree/.test(icon)) return 'glow';
  return undefined;
}

// The colour each kind shows when on (a colour light uses its own).
const TINTS: Partial<Record<Motion, number[]>> = {
  spin: [0, 188, 212],
  wiggle: [43, 182, 115],
  flicker: [124, 131, 253],
  beat: [124, 131, 253],
  shimmer: [255, 122, 60],
};
export const tintOf = (icon: SFSymbol) => TINTS[motionOf(icon) ?? 'glow'];

/** The icon's moving style (still with Reduce Motion on, or while off), and `loop` (0–1) for a flickering halo. */
export function useIconMotion(icon: SFSymbol, entity: HassEntity, isOn: boolean) {
  const still = useReducedMotion();
  const kind = motionOf(icon);
  const motion = isOn && !still ? kind : undefined;
  const percent: number = entity.attributes.percentage ?? 60; // a fan's speed; switches spin mid-speed
  const loop = useSharedValue(0);

  useEffect(() => {
    loop.set(0);
    const ease = (ms: number) => withRepeat(withTiming(1, { duration: ms, easing: Easing.inOut(Easing.quad) }), -1, true);
    if (motion === 'spin') loop.set(withRepeat(withTiming(1, { duration: 2400 - percent * 18, easing: Easing.linear }), -1));
    else if (motion === 'flicker')
      loop.set(withRepeat(withSequence(...[1, 0.3, 0.8, 0, 0.6, 0.15].map((v, i) => withTiming(v, { duration: [90, 140, 70, 260, 110, 330][i] }))), -1));
    else if (motion === 'beat') loop.set(ease(450));
    else if (motion === 'shimmer') loop.set(ease(1100));
    else if (motion === 'wiggle') loop.set(ease(300));
    return () => cancelAnimation(loop);
  }, [motion, percent, loop]);

  const style = useAnimatedStyle(() => ({
    opacity: motion === 'flicker' ? 0.65 + 0.35 * loop.value : motion === 'shimmer' ? 0.8 + 0.2 * loop.value : 1,
    transform: [
      { rotate: motion === 'spin' ? `${loop.value * 360}deg` : motion === 'wiggle' ? `${(loop.value - 0.5) * 18}deg` : '0deg' },
      { scale: motion === 'beat' ? 1 + loop.value * 0.14 : 1 },
      { translateY: motion === 'shimmer' ? -loop.value * 2.5 : 0 },
    ],
  }));
  return { kind, motion, style, loop };
}
