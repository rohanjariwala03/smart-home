import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';

import {
  ensureTally,
  HALLOWEEN_EVENT,
  HALLOWEEN_DIR,
  HALLOWEEN_ID,
  HALLOWEEN_SOUNDS,
  CROSSFADE,
  IPAD_PLAYLIST,
  IPAD_SOUNDS,
  HALLOWEEN_TALLY,
  halloweenOf,
  playSeconds,
  removeHalloween,
  setHalloween,
  tallyOf,
  useAutomation,
  useAutomationConfig,
  useNotifyServices,
  type Halloween,
} from '@/automations';
import { Chip } from '@/components/chip';
import { Card, Disclosure } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { browse, mediaUrl } from '@/components/timelapse';
import { Spacing } from '@/constants/theme';
import { byDomain, isEcho, name, players, useHA } from '@/ha';
import { auth } from '@/vision';

const ORANGE = '#FF7A1A';
const COLOUR_MODES = ['hs', 'rgb', 'rgbw', 'rgbww', 'xy'];

/** Oct 20 to 31: when the Halloween card shows on Home (gone from Nov 1 until next year). */
export const halloweenSeason = (d = new Date()) => d.getMonth() === 9 && d.getDate() >= 20;
/** Oct 31 from 3 PM to midnight: when the iPad wall shows the board and stays awake. */
const boardTime = (d = new Date()) => d.getMonth() === 9 && d.getDate() === 31 && d.getHours() >= 15;

function useHalloween() {
  const { conn, creds, entities, call } = useHA();
  const auto = useAutomation(HALLOWEEN_ID);
  const tallyState = entities[HALLOWEEN_TALLY]?.state;
  const tally = tallyOf(tallyState);
  const [photos, setPhotos] = useState<string[]>([]);
  // Re-read when the tally moves: a new group means a new picture soon after.
  useEffect(() => {
    if (!conn || !creds) return;
    browse(conn, `${HALLOWEEN_DIR}/${new Date().getFullYear()}-10-31`).then((list) => setPhotos(list.map((m) => mediaUrl(creds, m)).reverse()));
  }, [conn, creds, tallyState]);
  // Skips the "is it Halloween night" check; the count only goes up on the night itself.
  const tryIt = () => auto && call('automation', 'trigger', { entity_id: auto.entity_id, skip_condition: true });
  return { auto, tally, photos, tryIt };
}

/** The iPad wall shows the board on Halloween night once it's set up. */
export const useHalloweenBoard = () => !!useAutomation(HALLOWEEN_ID) && boardTime();

/** Home's card in the season: tonight's count, "Try it", and the setup. */
export function HalloweenCard() {
  const { creds } = useHA();
  const { auto, tally, photos, tryIt } = useHalloween();
  return (
    <Card>
      <ThemedText type="smallBold">Halloween</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {tally.total
          ? `${tally.total} group${tally.total === 1 ? '' : 's'} of trick-or-treaters${tally.busiest ? `, busiest at ${tally.busiest}` : ''}`
          : auto
            ? 'Ready for Oct 31, 4–11 PM. Motion at the door flickers the lights and plays a spooky sound.'
            : 'When trick-or-treaters come up the path, flicker the porch lights orange and purple and play a spooky sound.'}
      </ThemedText>
      {photos.length > 0 && creds && (
        <View style={styles.photos}>
          {photos.slice(0, 4).map((uri) => (
            <Image key={uri} source={{ uri, headers: auth(creds) }} style={styles.photo} contentFit="cover" />
          ))}
        </View>
      )}
      {auto && (
        <View style={styles.row}>
          <Chip icon="sparkles" label="Try it" onPress={tryIt} />
        </View>
      )}
      <Disclosure title="Set up" summary={auto ? 'On' : 'Off'}>
        <HalloweenSetup />
      </Disclosure>
    </Card>
  );
}

function HalloweenSetup() {
  const { conn, creds, entities, devices } = useHA();
  const notify = useNotifyServices();
  const auto = useAutomation(HALLOWEEN_ID);
  const saved = halloweenOf(useAutomationConfig(HALLOWEEN_ID));
  const [draft, setDraft] = useState<Halloween>();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string>();
  if (!creds || !conn) return null;

  const cameras = byDomain(entities, 'camera').filter((e) => e.attributes.snapshot_of && entities[`binary_sensor.${e.entity_id.split('.')[1]}_motion`]);
  const lights = byDomain(entities, 'light').filter((e) => e.attributes.supported_color_modes?.some((m: string) => COLOUR_MODES.includes(m)));
  const echoes = players(entities, devices).filter(isEcho);
  const h: Halloween = draft ??
    saved ?? { cameras: [], lights: [], ipad: true, sounds: HALLOWEEN_SOUNDS.map(([id]) => id), say: true, notify: notify[0] };
  const ipadSounds = h.ipadSounds ?? IPAD_PLAYLIST;
  const today = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD, like Home Assistant's
  const edit = (next: Partial<Halloween>) => setDraft({ ...h, ipadSounds, ...next });
  const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  const run = async (p: () => Promise<unknown>) => {
    setBusy(true);
    setNote(undefined);
    await p().then(() => setDraft(undefined), (e) => setNote(e?.message ?? String(e)));
    setBusy(false);
  };

  return (
    <View style={styles.setup}>
      <ThemedText type="small" themeColor="textSecondary">Watch for trick-or-treaters with</ThemedText>
      <View style={styles.row}>
        {cameras.map((e) => (
          <Chip key={e.entity_id} icon="video.fill" label={name(e)} selected={h.cameras.includes(e.entity_id)} onPress={() => edit({ cameras: toggle(h.cameras, e.entity_id) })} />
        ))}
      </View>
      <ThemedText type="small" themeColor="textSecondary">Flicker orange and purple</ThemedText>
      <View style={styles.row}>
        {lights.map((e) => (
          <Chip key={e.entity_id} icon="lightbulb.fill" label={name(e)} selected={h.lights.includes(e.entity_id)} onPress={() => edit({ lights: toggle(h.lights, e.entity_id) })} />
        ))}
      </View>
      <ThemedText type="small" themeColor="textSecondary">
        Play sounds on: the iPad plays them through its speaker or one paired with it (keep the app open on it); an Echo
        through one paired in the Alexa app
      </ThemedText>
      <View style={styles.row}>
        <Chip icon="ipad" label="iPad by the door" selected={!!h.ipad} onPress={() => edit({ ipad: !h.ipad })} />
        {echoes.map((e) => (
          <Chip key={e.entity_id} icon="homepod.fill" label={name(e)} selected={h.echo === e.entity_id} onPress={() => edit({ echo: h.echo === e.entity_id ? undefined : e.entity_id })} />
        ))}
      </View>
      {h.ipad && (
        <>
          <ThemedText type="small" themeColor="textSecondary">
            The iPad plays these one after another, in the order you pick them (picking one plays it here)
          </ThemedText>
          <View style={styles.row}>
            {IPAD_SOUNDS.map(([id, label]) => {
              const at = ipadSounds.indexOf(id);
              return (
                <Chip
                  key={id}
                  label={at < 0 ? label : `${at + 1}. ${label}`}
                  selected={at >= 0}
                  onPress={() => (at < 0 && playAll([SOUND_FILES[id]]), edit({ ipadSounds: toggle(ipadSounds, id) }))}
                />
              );
            })}
          </View>
          {ipadSounds.length > 0 && (
            <View style={styles.row}>
              <Chip
                icon="play.fill"
                label={`Play all (${playSeconds({ ipad: true, ipadSounds, say: h.say })} s)`}
                onPress={() => playAll([...ipadSounds.map((id) => SOUND_FILES[id]), ...(h.say ? [LINE_FILES[0]] : [])])}
              />
              <Chip icon="xmark" label="Clear" onPress={() => edit({ ipadSounds: [] })} />
            </View>
          )}
        </>
      )}
      {h.echo && (
        <>
          <ThemedText type="small" themeColor="textSecondary">The Echo’s sounds</ThemedText>
          <View style={styles.row}>
            {HALLOWEEN_SOUNDS.map(([id, label]) => (
              <Chip key={id} label={label} selected={h.sounds.includes(id)} onPress={() => edit({ sounds: toggle(h.sounds, id) })} />
            ))}
          </View>
        </>
      )}
      <View style={styles.row}>
        <ThemedText style={styles.flex}>Then a voice says “I… see… you.” or similar</ThemedText>
        <Switch value={h.say} onValueChange={(say) => edit({ say })} />
      </View>
      {notify.length > 0 && (
        <View style={styles.row}>
          <ThemedText style={styles.flex}>Recap on Nov 1 at 9 AM</ThemedText>
          <Switch value={!!h.notify} onValueChange={(on) => edit({ notify: on ? notify[0] : undefined })} />
        </View>
      )}
      <View style={styles.row}>
        <ThemedText style={styles.flex}>Practice today: camera motion works now too (not counted)</ThemedText>
        <Switch value={h.practice === today} onValueChange={(on) => edit({ practice: on ? today : undefined })} />
      </View>
      <View style={styles.row}>
        <Chip
          icon="checkmark"
          label={busy ? 'Saving…' : auto ? 'Save' : 'Turn on'}
          disabled={busy || !h.cameras.length}
          onPress={() => run(async () => (await ensureTally(conn, entities), await setHalloween(creds, h, entities)))}
        />
        {auto && <Chip icon="xmark" label="Turn off" disabled={busy} onPress={() => run(() => removeHalloween(creds))} />}
      </View>
      <ThemedText type="small" themeColor="textSecondary">
        Runs on Oct 31 from 4 to 11 PM and comes back next year. Once a minute at most (pictures keep coming); the iPad wall shows the count
        and has a button for a group the camera misses.
      </ThemedText>
      {note && <ThemedText type="small" style={styles.error}>{note}</ThemedText>}
    </View>
  );
}

// The iPad's sounds and spoken lines (made by scripts/make-halloween-sounds.py from CC0 recordings).
const SOUND_FILES: Record<string, number> = {
  creaky_door: require('@/assets/sounds/creaky_door.m4a'),
  heartbeat: require('@/assets/sounds/heartbeat.m4a'),
  thunder: require('@/assets/sounds/thunder.m4a'),
  evil_laugh: require('@/assets/sounds/evil_laugh.m4a'),
  evil_laugh_2: require('@/assets/sounds/evil_laugh_2.m4a'),
  witch_cackle: require('@/assets/sounds/witch_cackle.m4a'),
  ghost: require('@/assets/sounds/ghost.m4a'),
  scream: require('@/assets/sounds/scream.m4a'),
  haunted_choir: require('@/assets/sounds/haunted_choir.m4a'),
  monster_growl: require('@/assets/sounds/monster_growl.m4a'),
  monster_snarl: require('@/assets/sounds/monster_snarl.m4a'),
  monster_roar: require('@/assets/sounds/monster_roar.m4a'),
  monster_breath: require('@/assets/sounds/monster_breath.m4a'),
};
const LINE_FILES = [
  require('@/assets/sounds/line0.m4a'),
  require('@/assets/sounds/line1.m4a'),
  require('@/assets/sounds/line2.m4a'),
  require('@/assets/sounds/line3.m4a'),
];

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

/** Moves a player's volume from one level to another over CROSSFADE. */
async function fade(player: AudioPlayer, from: number, to: number) {
  for (let step = 0; step <= 10; step++) {
    player.volume = from + ((to - from) * step) / 10;
    await sleep((CROSSFADE * 1000) / 10);
  }
}

/**
 * Sounds one after another on this device (silent switch or not), each blending into the next over CROSSFADE so
 * there's no gap. All are loaded first. One run at a time.
 */
let playing = false;
async function playAll(files: number[]) {
  if (playing || !files.length) return;
  playing = true;
  const players = files.map((file) => createAudioPlayer(file));
  try {
    await setAudioModeAsync({ playsInSilentMode: true, interruptionMode: 'mixWithOthers' });
    for (let wait = 0; wait < 40 && players.some((p) => !p.isLoaded || !p.duration); wait++) await sleep(50);
    for (const [i, player] of players.entries()) {
      player.volume = i === 0 ? 1 : 0;
      player.play();
      if (i > 0) fade(player, 0, 1);
      await sleep(Math.max(0, (player.duration || 3) - CROSSFADE) * 1000);
      if (i < players.length - 1) fade(player, 1, 0);
      else await sleep(CROSSFADE * 1000 + 200);
    }
  } finally {
    setTimeout(() => players.forEach((p) => p.remove()), (CROSSFADE + 1) * 1000);
    playing = false;
  }
}

/** On the iPad: plays the Halloween automation's sound and line when it fires (a visit, Try it, or the board's button). */
export function HalloweenSounds() {
  const { conn } = useHA();
  useEffect(() => {
    if (!conn) return;
    // `sound` is from setups saved before the playlist.
    const sub = conn.subscribeEvents<{ data: { sounds?: string[]; sound?: string; line?: string | number } }>(({ data }) => {
      const ids = data.sounds ?? (data.sound ? [data.sound] : []);
      playAll([...ids.map((id) => SOUND_FILES[id]).filter(Boolean), LINE_FILES[Number(data.line)]].filter((f) => f != null));
    }, HALLOWEEN_EVENT);
    return () => void sub.then((unsub) => unsub(), () => {});
  }, [conn]);
  return null;
}

/** The iPad wall on Halloween night: the count, the latest groups, and a big button for one the camera missed. */
export function HalloweenBoard({ width, height }: { width: number; height: number }) {
  const { creds } = useHA();
  const { tally, photos, tryIt } = useHalloween();
  return (
    <View style={[styles.board, { width, height }]}>
      <View style={styles.count}>
        <Text style={styles.number}>{tally.total}</Text>
        <Text style={styles.label}>{tally.total === 1 ? 'group' : 'groups'} tonight</Text>
        {tally.busiest && <Text style={styles.small}>Busiest at {tally.busiest}</Text>}
      </View>
      <View style={styles.strip}>
        {creds &&
          photos.slice(0, 4).map((uri) => (
            <Image key={uri} source={{ uri, headers: auth(creds) }} style={[styles.boardPhoto, { height: height - Spacing.four * 2 }]} contentFit="cover" />
          ))}
      </View>
      <Pressable accessibilityRole="button" onPress={tryIt} style={({ pressed }) => [styles.treat, pressed && styles.pressed]}>
        <Text style={styles.treatText}>Trick or treat!</Text>
        <Text style={styles.small}>Tap for a group the camera missed</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: Spacing.two },
  setup: { gap: Spacing.two },
  photos: { flexDirection: 'row', gap: Spacing.one },
  photo: { flex: 1, aspectRatio: 16 / 9, borderRadius: 8, backgroundColor: '#0003' },
  error: { color: '#E5484D' },
  board: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    padding: Spacing.four,
    borderRadius: 28,
    backgroundColor: '#2A1206E6',
    borderWidth: 1,
    borderColor: `${ORANGE}66`,
  },
  count: { minWidth: 150 },
  number: { color: ORANGE, fontSize: 72, fontWeight: '200', fontVariant: ['tabular-nums'] },
  label: { color: '#fff', fontSize: 18, fontWeight: '600' },
  small: { color: '#FFFFFFAA', fontSize: 13, marginTop: 2 },
  strip: { flex: 1, flexDirection: 'row', gap: Spacing.two, overflow: 'hidden' },
  boardPhoto: { aspectRatio: 16 / 9, borderRadius: 14, backgroundColor: '#0006' },
  treat: { backgroundColor: ORANGE, borderRadius: 22, paddingVertical: Spacing.three, paddingHorizontal: Spacing.four, alignItems: 'center' },
  treatText: { color: '#1A0A00', fontSize: 22, fontWeight: '800' },
  pressed: { opacity: 0.7 },
});
