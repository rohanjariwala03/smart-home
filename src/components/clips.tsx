import { Directory, File, Paths } from 'expo-file-system';
import { SymbolView } from 'expo-symbols';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  ScrollView,
  SectionList,
  Share,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';

import { Chip } from '@/components/chip';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useHA, type Creds } from '@/ha';
import { useTheme } from '@/hooks/use-theme';
import { useRotation } from '@/orientation';
import type { Detection } from '@/vision';

// Motion clips from Blink Instant Events: the Sync Module's USB storage and Blink's cloud.
// Listing is metadata only. Opening a clip, or its thumbnail, makes Home Assistant fetch it from
// Blink (one at a time, then cached), so only the newest few rows load a thumbnail up front.
// With the Blink Vision add-on each clip also says who or what was in it, with that frame (stored locally).

export type Clip = {
  id: string;
  source: 'local' | 'cloud';
  slug: string;
  camera_name: string;
  created_at: string;
  size?: number | null;
  download_url: string;
  thumbnail_url?: string;
  cached?: boolean;
  detection?: Detection | null;
};

/** Clips from the last `hours`, newest first. */
export const fetchClips = (creds: Creds, source: string, hours: number, limit = 100, pages = 10) =>
  fetch(`${creds.url}/api/blink_instant_events/clips?source=${source}&hours=${hours}&limit=${limit}&pages=${pages}`, {
    headers: auth(creds),
  }).then((r) => (r.ok ? (r.json() as Promise<{ clips: Clip[] }>) : Promise.reject(new Error(`Couldn't load clips (HTTP ${r.status}).`))));

// What's in a clip, for the filter chips.
const KINDS = [
  ['person', 'People', (d: Detection) => d.labels.includes('person')],
  ['unknown', 'Unknown', (d: Detection) => d.unknown_faces > 0 || (d.labels.includes('person') && !d.people.length)],
  ['known', 'Known', (d: Detection) => d.people.length > 0],
  ['vehicle', 'Vehicles', (d: Detection) => d.labels.includes('vehicle')],
  ['animal', 'Animals', (d: Detection) => d.labels.includes('animal')],
] as const;

const DAYS = 30; // the most the proxy will list
const SOURCES = [
  ['both', 'All'],
  ['local', 'Sync Module'],
  ['cloud', 'Cloud'],
] as const;
const EAGER_THUMBNAILS = 6;

const auth = (creds: Creds) => ({ Authorization: `Bearer ${creds.token}` });

/** Downloads a video to the app's cache, then opens the share sheet: Save Video, Files, AirDrop, Messages… */
export async function shareVideo(url: string, headers?: Record<string, string>) {
  const file = await File.downloadFileAsync(url, new Directory(Paths.cache), { headers, idempotent: true });
  await Share.share({ url: file.uri });
}

export function ClipsSheet({ camera, initial, onClose }: { camera?: string; initial?: Clip; onClose: () => void }) {
  const { creds } = useHA();
  const [clips, setClips] = useState<Clip[]>();
  const [error, setError] = useState<string>();
  const [filter, setFilter] = useState(camera);
  const [kind, setKind] = useState<(typeof KINDS)[number][0]>();
  const [open, setOpen] = useState<Clip | undefined>(initial);
  const [source, setSource] = useState<(typeof SOURCES)[number][0]>('both');

  useEffect(() => {
    if (!creds) return;
    let cancelled = false;
    fetchClips(creds, source, DAYS * 24).then(
        (body) => !cancelled && setClips(body.clips),
        (e: Error) => !cancelled && setError(e.message),
      );
    return () => {
      cancelled = true;
    };
  }, [creds, source]);

  const cameras = [...new Map((clips ?? []).map((c) => [c.slug, c.camera_name])).entries()];
  const match = KINDS.find(([k]) => k === kind)?.[2];
  const shown = (clips ?? []).filter((c) => (!filter || c.slug === filter) && (!match || (c.detection && match(c.detection))));
  const smart = (clips ?? []).some((c) => c.detection);
  const sections = byDay(shown);

  return (
    <Modal
      visible
      animationType="slide"
      presentationStyle="pageSheet"
      supportedOrientations={['portrait', 'landscape']}
      onRequestClose={onClose}>
      <ThemedView style={styles.flex}>
        <View style={styles.header}>
          {open ? (
            <Pressable onPress={() => setOpen(undefined)} accessibilityRole="button" hitSlop={12}>
              <ThemedText type="linkPrimary">‹ Clips</ThemedText>
            </Pressable>
          ) : (
            <ThemedText type="subtitle">Clips</ThemedText>
          )}
          <View style={styles.flex} />
          <Pressable onPress={onClose} accessibilityRole="button" hitSlop={12}>
            <ThemedText type="linkPrimary">Done</ThemedText>
          </Pressable>
        </View>

        {open && creds ? (
          <ClipPlayer clip={open} creds={creds} />
        ) : error ? (
          <ThemedText style={styles.pad}>{error}</ThemedText>
        ) : !clips ? (
          <View style={styles.center}>
            <ActivityIndicator />
            <ThemedText themeColor="textSecondary">Asking Blink for clips…</ThemedText>
          </View>
        ) : (
          <SectionList
            sections={sections}
            keyExtractor={(c) => c.id}
            contentContainerStyle={styles.list}
            stickySectionHeadersEnabled={false}
            ListHeaderComponent={
              <View style={styles.filters}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
                  {SOURCES.map(([value, label]) => (
                    <Chip
                      key={value}
                      label={label}
                      selected={source === value}
                      onPress={() => {
                        setClips(undefined);
                        setSource(value);
                      }}
                    />
                  ))}
                </ScrollView>
                {cameras.length > 1 && (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
                    <Chip label="All cameras" selected={!filter} onPress={() => setFilter(undefined)} />
                    {cameras.map(([slug, name]) => (
                      <Chip key={slug} label={name} selected={filter === slug} onPress={() => setFilter(slug)} />
                    ))}
                  </ScrollView>
                )}
                {smart && (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
                    <Chip label="Everything" selected={!kind} onPress={() => setKind(undefined)} />
                    {KINDS.map(([k, label]) => (
                      <Chip key={k} label={label} selected={kind === k} onPress={() => setKind(k)} />
                    ))}
                  </ScrollView>
                )}
              </View>
            }
            ListFooterComponent={
              shown.length > 0 ? (
                <ThemedText type="small" themeColor="textSecondary" style={styles.footer}>
                  Showing the last {DAYS} days, the most Blink lists. Blink deletes cloud clips after 60
                  days.
                </ThemedText>
              ) : null
            }
            ListEmptyComponent={
              <ThemedText themeColor="textSecondary">
                {kind
                  ? 'No clips like that. Only clips recorded since Blink Vision started are labeled.'
                  : `No clips in the last ${DAYS} days. Clips need a Sync Module with USB storage, or a Blink subscription.`}
              </ThemedText>
            }
            renderSectionHeader={({ section }) => (
              <ThemedText type="smallBold" themeColor="textSecondary" style={styles.day}>
                {section.title}
              </ThemedText>
            )}
            renderItem={({ item }) => (
              <Row
                clip={item}
                creds={creds!}
                thumbnail={!!item.cached || !!item.detection || shown.indexOf(item) < EAGER_THUMBNAILS}
                onPress={() => setOpen(item)}
              />
            )}
          />
        )}
      </ThemedView>
    </Modal>
  );
}

function Row({ clip, creds, thumbnail, onPress }: { clip: Clip; creds: Creds; thumbnail: boolean; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${clip.camera_name} clip at ${time(clip)}${clip.detection ? `: ${clip.detection.summary}` : ''}`}
      onPress={onPress}
      style={({ pressed }) => [styles.row, { backgroundColor: theme.backgroundElement }, pressed && styles.pressed]}>
      <View style={[styles.thumb, { backgroundColor: theme.backgroundSelected }]}>
        {thumbnail && (clip.detection?.image_url ?? clip.thumbnail_url) ? (
          <Image source={{ uri: creds.url + (clip.detection?.image_url ?? clip.thumbnail_url), headers: auth(creds) }} style={styles.thumb} />
        ) : (
          <SymbolView name="play.rectangle.fill" size={24} tintColor={theme.textSecondary} />
        )}
      </View>
      <View style={styles.flex}>
        <ThemedText style={styles.bold}>{clip.camera_name}</ThemedText>
        {clip.detection && <ThemedText type="small">{clip.detection.summary}</ThemedText>}
        <ThemedText type="small" themeColor="textSecondary">
          {time(clip)} · {clip.source === 'local' ? 'Sync Module' : 'Cloud'}
          {clip.size ? ` · ${(clip.size / 1e6).toFixed(1)} MB` : ''}
        </ThemedText>
      </View>
      <SymbolView name="chevron.right" size={14} tintColor={theme.textSecondary} />
    </Pressable>
  );
}

function ClipPlayer({ clip, creds }: { clip: Clip; creds: Creds }) {
  const url = creds.url + clip.download_url;
  const source = useMemo(() => ({ uri: url, headers: auth(creds) }), [url, creds]);
  const player = useVideoPlayer(source, (p) => p.play());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const view = useRef<VideoView>(null);
  const { width, height } = useWindowDimensions();

  // Like other video apps: turning the phone sideways goes fullscreen; turning it back exits.
  useRotation();
  useEffect(() => {
    if (width > height) view.current?.enterFullscreen();
  }, [width, height]);

  const save = async () => {
    setSaving(true);
    setError(undefined);
    try {
      await shareVideo(url, auth(creds));
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={styles.playerWrap}>
      <VideoView
        ref={view}
        style={styles.video}
        player={player}
        nativeControls
        contentFit="contain"
        allowsPictureInPicture
        fullscreenOptions={{ enable: true, orientation: 'landscape', autoExitOnRotate: true }}
      />
      <View style={styles.pad}>
        <ThemedText type="subtitle">{clip.camera_name}</ThemedText>
        <ThemedText themeColor="textSecondary">
          {new Date(clip.created_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })} ·{' '}
          {clip.source === 'local' ? 'Sync Module' : 'Cloud'}
        </ThemedText>
        <Pressable
          accessibilityRole="button"
          disabled={saving}
          onPress={save}
          style={({ pressed }) => [styles.save, (pressed || saving) && styles.pressed]}>
          {saving ? <ActivityIndicator color="#fff" /> : <SymbolView name="square.and.arrow.down" size={18} tintColor="#fff" />}
          <ThemedText style={styles.saveText}>{saving ? 'Downloading…' : 'Save or share'}</ThemedText>
        </Pressable>
        {error && <ThemedText style={styles.error}>{error}</ThemedText>}
      </View>
    </View>
  );
}

export const time = (c: Clip) => new Date(c.created_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

function byDay(clips: Clip[]) {
  const today = new Date().toDateString();
  const yesterday = new Date(Date.now() - 864e5).toDateString();
  const sections: { title: string; data: Clip[] }[] = [];
  for (const c of clips) {
    const d = new Date(c.created_at);
    const key = d.toDateString();
    const title =
      key === today ? 'Today' : key === yesterday ? 'Yesterday' : d.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
    const last = sections[sections.length - 1];
    if (last?.title === title) last.data.push(c);
    else sections.push({ title, data: [c] });
  }
  return sections;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', padding: Spacing.three },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.two },
  list: { paddingHorizontal: Spacing.three, paddingBottom: Spacing.six, gap: Spacing.two },
  filters: { gap: Spacing.two, paddingBottom: Spacing.two },
  chips: { gap: Spacing.two },
  footer: { textAlign: 'center', marginTop: Spacing.four },
  day: { marginTop: Spacing.three, marginBottom: Spacing.one },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, padding: Spacing.two, borderRadius: 14 },
  thumb: { width: 96, height: 54, borderRadius: 8, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  bold: { fontWeight: '600' },
  pressed: { opacity: 0.6 },
  playerWrap: { flex: 1 },
  video: { width: '100%', aspectRatio: 16 / 9, backgroundColor: '#000' },
  pad: { padding: Spacing.three, gap: Spacing.two },
  save: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    backgroundColor: '#208AEF',
    borderRadius: 12,
    paddingVertical: 14,
    marginTop: Spacing.two,
  },
  saveText: { color: '#fff', fontWeight: '600' },
  error: { color: '#E5484D' },
});
