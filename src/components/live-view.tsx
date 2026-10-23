import { useEventListener } from 'expo';
import * as Haptics from 'expo-haptics';
import { SymbolView, type SFSymbol } from 'expo-symbols';
import { useVideoPlayer, VideoView, type VideoPlayer } from 'expo-video';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  AppState,
  Modal,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { FadeIn, FadeOut, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { shareVideo } from '@/components/clips';
import { Spacing } from '@/constants/theme';
import type { Creds } from '@/ha';
import { lockLandscape, lockPortrait, useRotation } from '@/orientation';

import MicStream from '../../modules/mic-stream';

// Plays the Blink Live View Proxy's HLS stream in iOS's own player (AVPlayer).
// HA auth buys a 10-minute token scoped to one camera; the playlist and its
// segments carry it. Fetching the playlist starts the camera; /stop frees it.
// Push-to-talk and camera controls ride the same live-view session (the `session` id).
// The proxy keeps a copy of every live view, which is what Record saves.
// Controls fade out a few seconds into playback; tap the video to bring them back. Pinch to zoom (drag to look
// around), double-tap to zoom back out or, unzoomed, to fill the screen.
export function LiveView({ creds, slug, title, ptt = true, onClose }: {
  creds: Creds;
  slug: string;
  title: string;
  ptt?: boolean;
  onClose: () => void;
}) {
  const base = cameraBase(creds, slug);
  const headers = useMemo(() => ({ Authorization: `Bearer ${creds.token}` }), [creds.token]);
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const landscape = width > height;
  const [attempt, setAttempt] = useState(0);
  const { stream, setStream, player, error, setError } = useLiveStream(base, headers, attempt);
  const token = stream?.token;
  const [live, setLive] = useState(false); // first frame shown
  const [ended, setEnded] = useState(false);
  const [muted, setMuted] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [panel, setPanel] = useState(false);
  const [recording, setRecording] = useState(false);
  const [saving, setSaving] = useState<string>();
  const [fill, setFill] = useState(false);

  useRotation();

  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => s !== 'active' && onClose());
    return () => sub.remove();
  }, [onClose]);

  useEventListener(player, 'statusChange', ({ status, error }) => {
    if (status === 'error' && !ended) setError(error?.message ?? 'The stream stopped.');
  });
  useEventListener(player, 'playToEnd', () => setEnded(true));

  useEffect(() => {
    if (!live || ended) return;
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [live, ended]);

  const retry = () => {
    setError(undefined);
    setStream(undefined);
    setLive(false);
    setEnded(false);
    setSeconds(0);
    setMuted(false);
    setRecording(false);
    setSaving(undefined);
    setAttempt((n) => n + 1);
  };

  // Record = end the live view, wait for the proxy to finish writing its copy, then save it.
  // ponytail: saves the whole live view, not just from when Record was tapped; trim with AVAssetExportSession if that matters.
  const save = async () => {
    if (!stream) return;
    setRecording(false);
    setEnded(true);
    pause(player);
    setSaving('Finishing the recording…');
    try {
      await fetch(`${base}/stop?token=${encodeURIComponent(stream.token)}`, { method: 'POST' }).catch(() => {});
      for (let i = 0; ; i++) {
        const info = await fetch(`${base}/last-liveview`, { headers }).then((r) => r.json());
        if (info.available && Date.parse(info.ended_at) >= stream.startedAt) break;
        if (i === 15) throw new Error('The recording isn’t ready yet. Tap Save video again in a moment.');
        await new Promise((r) => setTimeout(r, 1500));
      }
      setSaving('Downloading…');
      await shareVideo(`${base}/last-liveview.mp4`, headers);
      setSaving(undefined);
    } catch (e: any) {
      setSaving(e?.message ?? String(e));
    }
  };

  // Push-to-talk: hold to talk. The camera's sound is turned down meanwhile so it doesn't echo back.
  const [talk, setTalk] = useState<'off' | 'connecting' | 'on'>('off');
  const [talkError, setTalkError] = useState<string>();
  const holding = useRef(false); // released before the mic finished starting (e.g. the permission prompt)?
  useEventListener(MicStream, 'onStatus', (s) => {
    if (s.type === 'listening') setTalk('on');
    if (s.type === 'error') {
      setTalkError(s.message ?? 'Push-to-talk failed.');
      setTalk('off');
      volume(player, 1);
    }
  });
  const startTalk = () => {
    if (!stream) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setTalkError(undefined);
    holding.current = true;
    setTalk('connecting');
    volume(player, 0);
    const ws = base.replace(/^http/, 'ws');
    MicStream.start(`${ws}/ptt?token=${encodeURIComponent(stream.token)}&session=${stream.session}`).then(
      () => {
        if (!holding.current) MicStream.stop();
      },
      (e) => {
        setTalkError(e?.message ?? String(e));
        setTalk('off');
        volume(player, 1);
      },
    );
  };
  const stopTalk = () => {
    holding.current = false;
    setTalk('off');
    MicStream.stop();
    volume(player, 1);
  };
  useEffect(() => () => void MicStream.stop(), []);

  const playing = live && !ended && !error;

  // Controls: shown until playback starts, then hidden after a few idle seconds. They stay up while there's
  // something to read or hold (settings, talking, errors) and always with VoiceOver.
  const [shown, setShown] = useState(true);
  const [touched, setTouched] = useState(0);
  const [reader, setReader] = useState(false);
  useEffect(() => void AccessibilityInfo.isScreenReaderEnabled().then(setReader), []);
  const pinned = !playing || panel || talk !== 'off' || !!talkError || reader;
  const visible = shown || pinned;
  useEffect(() => {
    if (!visible || pinned) return;
    const t = setTimeout(() => setShown(false), 4000);
    return () => clearTimeout(t);
  }, [visible, pinned, touched]);
  const poke = () => setTouched((n) => n + 1);
  const zoom = useZoom(width, height);
  const gesture = Gesture.Simultaneous(
    zoom.gesture,
    Gesture.Exclusive(
      Gesture.Tap()
        .numberOfTaps(2)
        .runOnJS(true)
        .onEnd(() => (zoom.zoomed() ? zoom.reset() : setFill((f) => !f))),
      Gesture.Tap().runOnJS(true).onEnd(() => setShown(!visible)),
    ),
  );
  const message = error ?? (ended ? 'Live view ended' : !live ? 'Connecting to camera…' : undefined);
  const side = { paddingLeft: Math.max(insets.left, Spacing.three), paddingRight: Math.max(insets.right, Spacing.three) };
  const clock = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

  return (
    <Modal
      animationType="fade"
      presentationStyle="fullScreen"
      supportedOrientations={['portrait', 'landscape']}
      onRequestClose={onClose}>
      <GestureHandlerRootView style={styles.root}>
        <GestureDetector gesture={gesture}>
          <View
            style={StyleSheet.absoluteFill}
            accessible
            accessibilityLabel={`${title} live video`}
            accessibilityHint="Tap to show or hide the controls. Double-tap to fill the screen.">
            {token && !error && (
              <Animated.View style={[StyleSheet.absoluteFill, zoom.style]}>
                <VideoView
                  style={StyleSheet.absoluteFill}
                  player={player}
                  nativeControls={false}
                  contentFit={fill ? 'cover' : 'contain'}
                  onFirstFrameRender={() => setLive(true)}
                />
              </Animated.View>
            )}
          </View>
        </GestureDetector>

        {message && (
          <View style={styles.center}>
            {((!error && !ended) || saving?.endsWith('…')) && <ActivityIndicator color="#fff" size="large" />}
            <Text style={styles.message}>{saving ?? message}</Text>
            {(error || ended) && !saving?.endsWith('…') && (
              <View style={styles.row}>
                <Pill label="Watch again" icon="arrow.clockwise" onPress={retry} />
                {ended && <Pill label="Save video" icon="square.and.arrow.down" onPress={save} />}
              </View>
            )}
          </View>
        )}

        {visible && (
          <Animated.View
            entering={FadeIn.duration(200)}
            exiting={FadeOut.duration(300)}
            onTouchStart={poke}
            style={[styles.top, styles.topScrim, side, { paddingTop: insets.top + Spacing.two }]}>
            <View style={styles.flex}>
              <Text style={styles.title} numberOfLines={1}>
                {title}
              </Text>
              {playing && (
                <View style={styles.badge}>
                  <View style={styles.dot} />
                  <Text style={styles.badgeText}>
                    {recording ? 'REC' : 'LIVE'} {clock}
                  </Text>
                </View>
              )}
            </View>
            <Round icon="slider.horizontal.3" label="Camera settings" onPress={() => setPanel(!panel)} />
            <Round
              icon={landscape ? 'arrow.down.right.and.arrow.up.left' : 'arrow.up.left.and.arrow.down.right'}
              label={landscape ? 'Exit full screen' : 'Full screen'}
              onPress={() => (landscape ? lockPortrait() : lockLandscape())}
            />
            <Round icon="xmark" label="Close live view" onPress={onClose} />
          </Animated.View>
        )}

        {panel && stream && <ControlsPanel base={base} token={stream.token} session={stream.session} style={side} />}

        {visible && (
          <Animated.View
            entering={FadeIn.duration(200)}
            exiting={FadeOut.duration(300)}
            onTouchStart={poke}
            style={[styles.bottom, styles.bottomScrim, side, { paddingBottom: insets.bottom + Spacing.three }]}>
            {(talk !== 'off' || talkError) && (
              <Text style={styles.talkText}>
                {talkError ?? (talk === 'on' ? 'Talking… release to stop' : 'Connecting microphone…')}
              </Text>
            )}
            <View style={styles.controls}>
              <Round
                icon={muted ? 'speaker.slash.fill' : 'speaker.wave.2.fill'}
                label={muted ? 'Unmute' : 'Mute'}
                onPress={() => {
                  mute(player, !muted);
                  setMuted(!muted);
                }}
              />
              {ptt && (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Hold to talk"
                  disabled={!playing}
                  onPressIn={startTalk}
                  onPressOut={stopTalk}
                  style={[styles.big, talk === 'on' && styles.talking, !playing && styles.disabled]}>
                  <SymbolView name="mic.fill" size={28} tintColor={talk === 'on' ? '#fff' : '#000'} />
                </Pressable>
              )}
              <Round
                icon={recording ? 'stop.fill' : 'record.circle'}
                label={recording ? 'Stop recording and save' : 'Record'}
                tint={recording ? '#FF3B30' : undefined}
                disabled={!playing}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                  if (recording) save();
                  else setRecording(true);
                }}
              />
            </View>
          </Animated.View>
        )}
      </GestureHandlerRootView>
    </Modal>
  );
}

const MAX_ZOOM = 5;

/** Pinch to zoom up to 5×, one-finger drag to pan while zoomed, kept inside the screen. Runs on the UI thread. */
function useZoom(width: number, height: number) {
  const scale = useSharedValue(1);
  const start = useSharedValue(1);
  const x = useSharedValue(0);
  const y = useSharedValue(0);
  const startX = useSharedValue(0);
  const startY = useSharedValue(0);

  const clamp = (v: number, size: number, s: number) => {
    'worklet';
    const max = ((s - 1) * size) / 2;
    return Math.min(max, Math.max(-max, v));
  };
  const pinch = Gesture.Pinch()
    .onStart(() => {
      start.value = scale.value;
    })
    .onUpdate((e) => {
      scale.value = Math.min(MAX_ZOOM, Math.max(1, start.value * e.scale));
      x.value = clamp(x.value, width, scale.value);
      y.value = clamp(y.value, height, scale.value);
    });
  const pan = Gesture.Pan()
    .averageTouches(true)
    .onStart(() => {
      startX.value = x.value;
      startY.value = y.value;
    })
    .onUpdate((e) => {
      if (scale.value <= 1) return;
      x.value = clamp(startX.value + e.translationX, width, scale.value);
      y.value = clamp(startY.value + e.translationY, height, scale.value);
    });
  const style = useAnimatedStyle(() => ({
    transform: [{ translateX: x.value }, { translateY: y.value }, { scale: scale.value }],
  }));

  return {
    gesture: Gesture.Simultaneous(pinch, pan),
    style,
    zoomed: () => scale.get() > 1.01,
    reset: () => {
      scale.set(withTiming(1));
      x.set(withTiming(0));
      y.set(withTiming(0));
    },
  };
}

/**
 * One camera's live stream: a camera token, a session id, and an AVPlayer on the HLS playlist.
 * Stops the camera when unmounted or when `attempt` changes. Errors are left to the caller.
 */
export function useLiveStream(base: string, headers: Record<string, string>, attempt: number) {
  const [stream, setStream] = useState<{ token: string; session: string; startedAt: number }>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    let cancelled = false;
    fetch(`${base}/token`, { headers })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`Couldn't start live view (HTTP ${r.status}).`))))
      .then(
        (body: { token: string }) =>
          !cancelled &&
          setStream({ token: body.token, session: Math.random().toString(36).slice(2), startedAt: Date.now() }),
        (e: Error) => !cancelled && setError(e.message),
      );
    return () => {
      cancelled = true;
    };
  }, [base, headers, attempt]);

  // Free the camera as soon as we stop watching, instead of at the proxy's idle timeout.
  const token = stream?.token;
  useEffect(() => {
    if (!token) return;
    return () => {
      fetch(`${base}/stop?token=${encodeURIComponent(token)}`, { method: 'POST' }).catch(() => {});
    };
  }, [base, token]);

  // Memoised: a new source object would make a new player (and a new camera session) on every render.
  const source = useMemo(
    () =>
      stream
        ? { uri: `${base}/hls/index.m3u8?token=${encodeURIComponent(stream.token)}&session=${stream.session}` }
        : null,
    [base, stream],
  );
  const player = useVideoPlayer(source, (p) => p.play());
  return { stream, setStream, player, error, setError };
}

export const cameraBase = (creds: Creds, slug: string) =>
  `${creds.url}/api/blink_instant_events/cameras/${encodeURIComponent(slug)}`;

type Controls = {
  capabilities: Record<string, boolean>;
  flood_light: boolean | null;
  night_vision: 'auto' | 'on' | 'off' | null;
  volume: number | null;
  temperature: number | null;
  temperature_unit: string | null;
  rejected?: string[];
  busy?: string[];
  deferred?: string[];
};

/** The camera's own settings (night vision, flood light, speaker volume), as far as this model has them. */
function ControlsPanel({ base, token, session, style }: { base: string; token: string; session: string; style: object }) {
  const [c, setC] = useState<Controls>();
  const [note, setNote] = useState<string>();
  const url = `${base}/controls?token=${encodeURIComponent(token)}&session=${session}`;

  useEffect(() => {
    fetch(url)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`Couldn't read settings (HTTP ${r.status}).`))))
      .then(setC, (e: Error) => setNote(e.message));
  }, [url]);

  const set = (change: Partial<Controls>) => {
    setC((prev) => prev && { ...prev, ...change });
    setNote('Saving…');
    fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(change) })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`Blink refused (HTTP ${r.status}).`))))
      .then(
        (next: Controls) => {
          setC(next);
          setNote(
            next.busy?.length ? 'The camera is busy. Try again in a moment.'
            : next.rejected?.length ? `Blink didn't accept: ${next.rejected.join(', ')}.`
            : next.deferred?.length ? 'Saved. Applies when this live view ends.'
            : undefined,
          );
        },
        (e: Error) => setNote(e.message),
      );
  };

  const can = c?.capabilities ?? {};
  return (
    <View style={[styles.panel, style]}>
      <View style={styles.panelCard}>
        {!c && !note && <ActivityIndicator color="#fff" />}
        {can.night_vision && (
          <View style={styles.setting}>
            <Text style={styles.label}>Night vision</Text>
            <View style={styles.row}>
              {(['auto', 'on', 'off'] as const).map((v) => (
                <Seg key={v} label={v[0].toUpperCase() + v.slice(1)} on={c?.night_vision === v} onPress={() => set({ night_vision: v })} />
              ))}
            </View>
          </View>
        )}
        {can.flood_light && (
          <View style={styles.settingRow}>
            <Text style={styles.label}>Flood light</Text>
            <Switch value={!!c?.flood_light} onValueChange={(on) => set({ flood_light: on })} />
          </View>
        )}
        {can.volume && (
          <View style={styles.setting}>
            <Text style={styles.label}>Speaker volume (next live view)</Text>
            <View style={styles.row}>
              {[1, 2, 3, 4, 5, 6, 7, 8].map((v) => (
                <Seg key={v} label={String(v)} on={c?.volume === v} onPress={() => set({ volume: v })} />
              ))}
            </View>
          </View>
        )}
        {can.temperature && c?.temperature != null && (
          <View style={styles.settingRow}>
            <Text style={styles.label}>Temperature</Text>
            <Text style={styles.label}>
              {Math.round(c.temperature)}
              {c.temperature_unit}
            </Text>
          </View>
        )}
        {c && !Object.values(can).some(Boolean) && <Text style={styles.label}>No settings for this camera.</Text>}
        {note && <Text style={styles.note}>{note}</Text>}
      </View>
    </View>
  );
}

// expo-video players are mutable native objects; React's lint rule can't tell, so mutate outside the component.
export const mute = (player: VideoPlayer, muted: boolean) => {
  player.muted = muted;
};
// Volume, unlike muted, doesn't make expo-video reset the audio session (which would cut the mic).
const volume = (player: VideoPlayer, v: number) => {
  player.volume = v;
};
const pause = (player: VideoPlayer) => player.pause();

function Round({ icon, label, tint, disabled, onPress }: {
  icon: SFSymbol;
  label: string;
  tint?: string;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={8}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.round, pressed && styles.pressed, disabled && styles.disabled]}>
      <SymbolView name={icon} size={20} tintColor={tint ?? '#fff'} />
    </Pressable>
  );
}

function Seg({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
      onPress={onPress}
      style={[styles.seg, on && styles.segOn]}>
      <Text style={[styles.segText, on && styles.segTextOn]}>{label}</Text>
    </Pressable>
  );
}

function Pill({ icon, label, onPress }: { icon: SFSymbol; label: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.pill, pressed && styles.pressed]}>
      <SymbolView name={icon} size={16} tintColor="#000" />
      <Text style={styles.pillText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  root: { flex: 1, backgroundColor: '#000' },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two, justifyContent: 'center' },
  top: { position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  bottom: { position: 'absolute', bottom: 0, left: 0, right: 0, alignItems: 'center', gap: Spacing.three },
  // Shade behind the controls so they read over a bright picture.
  topScrim: { paddingBottom: Spacing.five, experimental_backgroundImage: 'linear-gradient(180deg, rgba(0,0,0,0.55), transparent)' },
  bottomScrim: { paddingTop: Spacing.five, experimental_backgroundImage: 'linear-gradient(0deg, rgba(0,0,0,0.55), transparent)' },
  controls: { flexDirection: 'row', alignItems: 'center', gap: Spacing.five },
  big: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' },
  talking: { backgroundColor: '#FF3B30', transform: [{ scale: 1.08 }] },
  disabled: { opacity: 0.35 },
  talkText: { color: '#fff', fontSize: 15, fontWeight: '600', paddingHorizontal: Spacing.four, textAlign: 'center' },
  title: { color: '#fff', fontSize: 20, fontWeight: '700' },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#FF3B30' },
  badgeText: { color: '#fff', fontSize: 13, fontWeight: '600', fontVariant: ['tabular-nums'] },
  round: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  pressed: { opacity: 0.6 },
  center: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.three,
    padding: Spacing.four,
  },
  message: { color: '#fff', fontSize: 16, textAlign: 'center' },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    backgroundColor: '#fff',
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 999,
  },
  pillText: { color: '#000', fontSize: 16, fontWeight: '600' },
  panel: { position: 'absolute', top: 110, left: 0, right: 0, alignItems: 'flex-end' },
  panelCard: {
    width: 300,
    maxWidth: '100%',
    backgroundColor: 'rgba(28,28,30,0.92)',
    borderRadius: 16,
    padding: Spacing.three,
    gap: Spacing.three,
  },
  setting: { gap: Spacing.two },
  settingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  label: { color: '#fff', fontSize: 15 },
  note: { color: '#ccc', fontSize: 13 },
  seg: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.15)' },
  segOn: { backgroundColor: '#fff' },
  segText: { color: '#fff', fontWeight: '600' },
  segTextOn: { color: '#000' },
});
