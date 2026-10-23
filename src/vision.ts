import { fetch } from 'expo/fetch';
import { File } from 'expo-file-system';
import { useCallback, useEffect, useState } from 'react';

import { useHA, type Creds } from '@/ha';

// Blink Vision: the Home Assistant add-on in github.com/rohanjariwala03/ha-blink-instant-events that reads each new
// clip for faces (people taught here), people, vehicles and animals. Blink Instant Events passes these through.

export const PEOPLE = '/api/blink_instant_events/people';

export type Person = { name: string; photos: number };
export type Detection = {
  summary: string;
  people: string[];
  unknown_faces: number;
  labels: string[];
  known_only: boolean;
  image_url: string;
};

export const auth = (creds: Creds) => ({ Authorization: `Bearer ${creds.token}` });
export const faceUrl = (creds: Creds, name: string) => `${creds.url}${PEOPLE}/${encodeURIComponent(name)}.jpg`;

/** The people Blink Vision knows; `people` is null while it isn't installed or running. */
export function usePeople() {
  const { creds } = useHA();
  const [people, setPeople] = useState<Person[] | null>();
  const [error, setError] = useState<string>();

  const refresh = useCallback(() => {
    if (!creds) return;
    fetch(`${creds.url}${PEOPLE}`, { headers: auth(creds) })
      .then(async (r) => {
        if (r.status === 503 || r.status === 404) return setPeople(null);
        if (!r.ok) throw new Error(`Home Assistant returned ${r.status}`);
        setPeople(((await r.json()) as { people: Person[] }).people);
        setError(undefined);
      })
      .catch((e: Error) => setError(e.message));
  }, [creds]);

  useEffect(refresh, [refresh]);
  return { people, error, refresh };
}

/** Teach Blink Vision `name`'s face from each photo; the errors are per photo ("No face found in this photo"). */
export async function addPhotos(creds: Creds, name: string, uris: string[]) {
  const errors: string[] = [];
  for (const [i, uri] of uris.entries()) {
    const r = await fetch(`${creds.url}${PEOPLE}/${encodeURIComponent(name)}`, {
      method: 'POST',
      headers: { ...auth(creds), 'Content-Type': 'image/jpeg' },
      body: new File(uri),
    });
    if (!r.ok) {
      const why = await r.json().then((b: { error?: string }) => b.error, () => undefined);
      errors.push(`Photo ${i + 1}: ${why ?? (r.status === 403 ? 'only an admin can teach faces' : `error ${r.status}`)}`);
    }
  }
  return errors;
}

export async function removePerson(creds: Creds, name: string) {
  const r = await fetch(`${creds.url}${PEOPLE}/${encodeURIComponent(name)}`, { method: 'DELETE', headers: auth(creds) });
  if (!r.ok) throw new Error(`Home Assistant returned ${r.status}`);
}
