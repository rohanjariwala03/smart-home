import Slider from '@react-native-community/slider';
import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Switch, View } from 'react-native';

import { removeAutomation, setTimelapse, TIMELAPSE_DIR, TIMELAPSE_ID, useAutomation } from '@/automations';
import { Chip } from '@/components/chip';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { name, useHA } from '@/ha';
import { auth } from '@/vision';

type Media = { title: string; media_content_id: string; children?: Media[] };
const ROOT = `media-source://media_source/local/${TIMELAPSE_DIR}`;
const FPS = 10;

/** The noon pictures saved by the time-lapse automation, played back as a flipbook, one camera at a time. */
export function TimelapseSheet({ onClose }: { onClose: () => void }) {
  const { conn, creds, entities } = useHA();
  const auto = useAutomation(TIMELAPSE_ID);
  const [folders, setFolders] = useState<Media[]>();
  const [folder, setFolder] = useState<string>();
  const [frames, setFrames] = useState<string[]>();
  const [at, setAt] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [note, setNote] = useState<string>();

  // No folder yet (nothing saved) is an error from Home Assistant; that's just "no cameras yet".
  useEffect(() => {
    conn
      ?.sendMessagePromise<Media>({ type: 'media_source/browse_media', media_content_id: ROOT })
      .then((r) => r.children ?? [], () => [])
      .then((list) => {
        setFolders(list);
        setFolder((f) => f ?? list[0]?.title);
      });
  }, [conn]);

  useEffect(() => {
    if (!conn || !creds || !folder) return;
    conn.sendMessagePromise<Media>({ type: 'media_source/browse_media', media_content_id: `${ROOT}/${folder}` }).then(
      (r) => {
        const urls = (r.children ?? [])
          .filter((c) => c.title.endsWith('.jpg'))
          .sort((a, b) => a.title.localeCompare(b.title))
          .map((c) => `${creds.url}/media/local/${c.media_content_id.split('/local/')[1]}`);
        Image.prefetch(urls, { headers: auth(creds) });
        setFrames(urls);
        setAt(urls.length - 1);
      },
      () => setFrames([]),
    );
  }, [conn, creds, folder]);

  useEffect(() => {
    if (!playing || !frames) return;
    const t = setTimeout(() => (at + 1 < frames.length ? setAt(at + 1) : setPlaying(false)), 1000 / FPS);
    return () => clearTimeout(t);
  }, [playing, frames, at]);

  if (!creds) return null;
  const toggle = (on: boolean) => {
    setNote(undefined);
    (on ? setTimelapse(creds) : removeAutomation(creds, TIMELAPSE_ID)).catch((e) => setNote(e?.message ?? String(e)));
  };
  const frame = frames?.[at];
  const day = frame?.match(/(\d{4})-(\d\d)-(\d\d)\.jpg$/);
  const play = () => {
    if (frames && at >= frames.length - 1) setAt(0);
    setPlaying(!playing);
  };

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <ThemedView style={styles.flex}>
        <View style={styles.header}>
          <ThemedText type="subtitle">Time-lapse</ThemedText>
          <View style={styles.flex} />
          <Pressable onPress={onClose} accessibilityRole="button" hitSlop={12}>
            <ThemedText type="linkPrimary">Done</ThemedText>
          </Pressable>
        </View>
        <View style={styles.body}>
          <View style={styles.row}>
            <ThemedText style={styles.flex}>Save a picture every day at noon</ThemedText>
            <Switch value={!!auto} onValueChange={toggle} />
          </View>
          <ThemedText type="small" themeColor="textSecondary">
            Each camera takes a new snapshot at noon, the same light all year, and Home Assistant keeps it in Media ›
            timelapse. About 70 MB a year per camera.
          </ThemedText>
          {note && <ThemedText type="small" style={styles.error}>{note}</ThemedText>}

          {folders === undefined ? (
            <ActivityIndicator />
          ) : folders.length === 0 ? (
            <ThemedText themeColor="textSecondary">
              {auto ? 'The first pictures arrive at noon.' : 'Turn it on to start collecting pictures.'}
            </ThemedText>
          ) : (
            <>
              {folders.length > 1 && (
                <View style={styles.row}>
                  {folders.map((f) => (
                    <Chip
                      key={f.title}
                      label={entities[`camera.${f.title}`] ? name(entities[`camera.${f.title}`]) : f.title}
                      selected={folder === f.title}
                      onPress={() => (setPlaying(false), setFrames(undefined), setFolder(f.title))}
                    />
                  ))}
                </View>
              )}
              <View style={styles.screen}>
                {frame ? (
                  <Image style={styles.flex} contentFit="contain" source={{ uri: frame, headers: auth(creds) }} transition={0} />
                ) : (
                  <ActivityIndicator style={styles.flex} />
                )}
              </View>
              {frames && frames.length > 0 && (
                <>
                  <View style={styles.row}>
                    <Chip icon={playing ? 'pause.fill' : 'play.fill'} label={playing ? 'Pause' : 'Play'} onPress={play} />
                    <ThemedText style={styles.flex}>
                      {day ? new Date(+day[1], +day[2] - 1, +day[3]).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' }) : ''}
                    </ThemedText>
                    <ThemedText type="small" themeColor="textSecondary">
                      {frames.length} day{frames.length === 1 ? '' : 's'}
                    </ThemedText>
                  </View>
                  <Slider
                    minimumValue={0}
                    maximumValue={Math.max(frames.length - 1, 1)}
                    step={1}
                    value={at}
                    onValueChange={(v) => (setPlaying(false), setAt(v))}
                    accessibilityLabel="Day"
                  />
                </>
              )}
            </>
          )}
        </View>
      </ThemedView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', padding: Spacing.three },
  body: { paddingHorizontal: Spacing.three, gap: Spacing.three },
  row: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: Spacing.two },
  screen: { aspectRatio: 16 / 9, borderRadius: 14, overflow: 'hidden', backgroundColor: '#000' },
  error: { color: '#E5484D' },
});
