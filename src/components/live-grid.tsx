import { useEventListener } from 'expo';
import { SymbolView } from 'expo-symbols';
import { VideoView } from 'expo-video';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, AppState, Modal, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { cameraBase, mute, useLiveStream } from '@/components/live-view';
import { Spacing } from '@/constants/theme';
import type { Creds } from '@/ha';
import { useRotation } from '@/orientation';

export type GridCamera = { slug: string; name: string };

// Several cameras live at once, each its own proxy session. Muted; tap one to hear it and
// make it big, tap again to go back. Blink may refuse some at once (the Sync Module's
// bandwidth), so each tile fails and retries on its own.
export function LiveGrid({ creds, cameras, onClose }: { creds: Creds; cameras: GridCamera[]; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const [focus, setFocus] = useState<string>();
  useRotation();

  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => s !== 'active' && onClose());
    return () => sub.remove();
  }, [onClose]);

  const landscape = width > height;
  const columns = focus ? 1 : landscape || cameras.length > 3 ? 2 : 1;
  const usable = width - insets.left - insets.right - Spacing.two * (columns + 1);
  const tileWidth = usable / columns;

  return (
    <Modal
      animationType="fade"
      presentationStyle="fullScreen"
      backdropColor="#000" // the default white flashes while it fades out
      supportedOrientations={['portrait', 'landscape']}
      onRequestClose={onClose}>
      <View style={[styles.root, { paddingTop: insets.top, paddingLeft: insets.left, paddingRight: insets.right }]}>
        <View style={styles.header}>
          <Text style={styles.title}>All cameras</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Close" hitSlop={8} onPress={onClose} style={styles.round}>
            <SymbolView name="xmark" size={18} tintColor="#fff" />
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={[styles.grid, { paddingBottom: insets.bottom + Spacing.three }]}>
          {cameras.map((c) => (
            <LiveTile
              key={c.slug}
              creds={creds}
              camera={c}
              width={tileWidth}
              maxHeight={focus ? height - insets.top - insets.bottom - 80 : undefined}
              hidden={!!focus && focus !== c.slug}
              focused={focus === c.slug}
              onPress={() => setFocus(focus === c.slug ? undefined : c.slug)}
            />
          ))}
        </ScrollView>
      </View>
    </Modal>
  );
}

/** One live camera (also the iPad dashboard's camera page). */
export function LiveTile({ creds, camera, width, height, maxHeight, hidden, focused, onPress }: {
  creds: Creds;
  camera: GridCamera;
  width: number;
  height?: number; // 16:9 by default
  maxHeight?: number;
  hidden: boolean;
  focused: boolean;
  onPress: () => void;
}) {
  const base = cameraBase(creds, camera.slug);
  const headers = useMemo(() => ({ Authorization: `Bearer ${creds.token}` }), [creds.token]);
  const [attempt, setAttempt] = useState(0);
  const [live, setLive] = useState(false);
  const [ended, setEnded] = useState(false);
  const { player, error, setError, setStream } = useLiveStream(base, headers, attempt);

  useEventListener(player, 'statusChange', ({ status, error }) => {
    if (status === 'error') setError(error?.message ?? 'Stopped');
  });
  useEventListener(player, 'playToEnd', () => setEnded(true));
  // Only the camera you've tapped plays sound.
  useEffect(() => mute(player, !focused), [player, focused]);

  const retry = () => {
    setError(undefined);
    setStream(undefined);
    setLive(false);
    setEnded(false);
    setAttempt((n) => n + 1);
  };

  // Hidden tiles stay mounted so their streams keep running behind the focused one.
  const h = height ?? Math.min((width * 9) / 16, maxHeight ?? Infinity);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${camera.name}${focused ? ', tap to go back' : ', tap to enlarge'}`}
      onPress={error || ended ? retry : onPress}
      style={[styles.tile, { width, height: h }, hidden && styles.hidden]}>
      {!error && <VideoView style={StyleSheet.absoluteFill} player={player} nativeControls={false} contentFit="contain" onFirstFrameRender={() => setLive(true)} />}
      {(!live || error || ended) && (
        <View style={styles.center}>
          {!error && !ended ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <>
              <SymbolView name="arrow.clockwise" size={20} tintColor="#fff" />
              <Text style={styles.small}>{ended ? 'Ended · tap to restart' : `${error} · tap to retry`}</Text>
            </>
          )}
        </View>
      )}
      <View style={styles.label}>
        {live && !error && !ended && <View style={styles.dot} />}
        <Text style={styles.name} numberOfLines={1}>
          {camera.name}
        </Text>
        {focused && <SymbolView name="speaker.wave.2.fill" size={12} tintColor="#fff" />}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  header: { flexDirection: 'row', alignItems: 'center', padding: Spacing.three },
  title: { flex: 1, color: '#fff', fontSize: 20, fontWeight: '700' },
  round: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two, paddingHorizontal: Spacing.two },
  tile: { borderRadius: 12, overflow: 'hidden', backgroundColor: '#111' },
  hidden: { position: 'absolute', width: 1, height: 1, opacity: 0 },
  center: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', gap: Spacing.two, padding: Spacing.two },
  small: { color: '#fff', fontSize: 13, textAlign: 'center' },
  label: {
    position: 'absolute',
    left: Spacing.two,
    bottom: Spacing.two,
    right: Spacing.two,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#FF3B30' },
  name: { color: '#fff', fontWeight: '600', fontSize: 14, textShadowColor: '#000', textShadowRadius: 4, flexShrink: 1 },
});
