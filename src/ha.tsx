import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';
import {
  callService,
  createConnection,
  createLongLivedTokenAuth,
  ERR_INVALID_AUTH,
  subscribeEntities,
  type Connection,
  type HassEntities,
  type HassEntity,
} from 'home-assistant-js-websocket';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { Alert, AppState } from 'react-native';

// home-assistant-js-websocket handles the auth handshake, request ids,
// reconnect with backoff and re-subscribing after a reconnect.

export type Creds = { url: string; token: string };

export type Status = 'loading' | 'no-config' | 'connecting' | 'ready' | 'disconnected' | 'error';

type HA = {
  creds: Creds | null;
  conn: Connection | null;
  status: Status;
  error?: string;
  entities: HassEntities;
  /** entity_id → area name, from HA's registries. Empty if the user may not read them. */
  areas: Record<string, string>;
  /** entity_id → the physical device it belongs to (same source as areas). */
  devices: Record<string, Device>;
  save: (creds: Creds) => Promise<void>;
  /** Re-read rooms and devices, e.g. after renaming or moving one. */
  reloadRegistry: () => void;
  /** Resolves false if HA refused (the user has already been told). */
  call: (domain: string, service: string, data: object) => Promise<boolean>;
};

const KEY = 'ha-creds';

// Copy of the creds for the home-screen widget (targets/widget/Widget.swift reads it).
// Shared keychain group, readable after first unlock so the widget can refresh while locked.
const ios = Constants.expoConfig?.ios;
export const SHARED_KEYCHAIN = {
  accessGroup: `${ios?.appleTeamId}.${ios?.bundleIdentifier}.shared`,
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
};
const shareWithWidget = (creds: Creds) =>
  SecureStore.setItemAsync('ha-widget', JSON.stringify(creds), SHARED_KEYCHAIN).catch(() => {});

type Area = { area_id: string; name: string };
export type Device = {
  id: string;
  area_id: string | null;
  name: string | null;
  name_by_user: string | null;
  manufacturer: string | null;
  model: string | null;
};
type Entity = { entity_id: string; device_id: string | null; area_id: string | null };

// An entity's own area wins over its device's area.
async function loadRegistry(conn: Connection) {
  const [areas, devices, ents] = await Promise.all([
    conn.sendMessagePromise<Area[]>({ type: 'config/area_registry/list' }),
    conn.sendMessagePromise<Device[]>({ type: 'config/device_registry/list' }),
    conn.sendMessagePromise<Entity[]>({ type: 'config/entity_registry/list' }),
  ]);
  const areaName = Object.fromEntries(areas.map((x) => [x.area_id, x.name]));
  const byId = Object.fromEntries(devices.map((x) => [x.id, x]));
  return {
    areas: Object.fromEntries(
      ents.flatMap((x) => {
        const area = x.area_id ?? (x.device_id ? byId[x.device_id]?.area_id : null);
        return area && areaName[area] ? [[x.entity_id, areaName[area]]] : [];
      }),
    ),
    devices: Object.fromEntries(
      ents.flatMap((x) => (x.device_id && byId[x.device_id] ? [[x.entity_id, byId[x.device_id]]] : [])),
    ),
  };
}

const EMPTY = { areas: {}, devices: {} };

const Ctx = createContext<HA | null>(null);

export function useHA() {
  const ha = useContext(Ctx);
  if (!ha) throw new Error('useHA outside HAProvider');
  return ha;
}

export function HAProvider({ children }: { children: ReactNode }) {
  const [creds, setCreds] = useState<Creds | null | undefined>(undefined);
  const [conn, setConn] = useState<Connection | null>(null);
  const [live, setLive] = useState<'ready' | 'disconnected' | 'error'>('ready');
  const [error, setError] = useState<string>();
  const [attempt, setAttempt] = useState(0); // bumped to try connecting again after a failure
  const [entities, setEntities] = useState<HassEntities>({});
  const [registry, setRegistry] = useState<{ areas: Record<string, string>; devices: Record<string, Device> }>(
    EMPTY,
  );

  const status: Status =
    creds === undefined ? 'loading'
    : creds === null ? 'no-config'
    : error ? 'error'
    : !conn ? 'connecting'
    : live;

  useEffect(() => {
    SecureStore.getItemAsync(KEY).then((v) => {
      const saved: Creds | null = v ? JSON.parse(v) : null;
      if (saved) shareWithWidget(saved);
      setCreds(saved);
    });
  }, []);

  useEffect(() => {
    if (!creds) return;
    let cancelled = false;
    let c: Connection | undefined;
    let unsub: (() => void) | undefined;

    createConnection({ auth: createLongLivedTokenAuth(creds.url, creds.token), setupRetry: 5 }).then(
      (connection) => {
        if (cancelled) return connection.close();
        c = connection;
        // ponytail: registries reload on (re)connect only; subscribe to *_registry_updated if live edits matter.
        const refreshAreas = () => loadRegistry(connection).then(setRegistry, () => {});
        refreshAreas();
        connection.addEventListener('ready', () => {
          setLive('ready');
          refreshAreas();
        });
        connection.addEventListener('disconnected', () => setLive('disconnected'));
        connection.addEventListener('reconnect-error', () => setLive('error'));
        unsub = subscribeEntities(connection, (all) => setEntities(all));
        setError(undefined);
        setLive('ready');
        setConn(connection);
      },
      (err) => {
        if (!cancelled) setError(err === ERR_INVALID_AUTH ? 'Invalid token' : `Cannot reach ${creds.url}`);
      },
    );

    return () => {
      cancelled = true;
      unsub?.();
      c?.close();
    };
  }, [creds, attempt]);

  // HA on a sleeping or away Mac can't be reached: keep trying every 15 s, and right away when the app comes back
  // to the foreground, so the app reconnects by itself once the hub is back. A wrong token isn't retried.
  const unreachable = !!error && error !== 'Invalid token';
  useEffect(() => {
    if (!unreachable) return;
    const retry = () => setAttempt((n) => n + 1); // the error (and the offline card) stays until a try succeeds
    const timer = setInterval(retry, 15_000);
    const sub = AppState.addEventListener('change', (s) => s === 'active' && retry());
    return () => {
      clearInterval(timer);
      sub.remove();
    };
  }, [unreachable]);

  const save = async (next: Creds) => {
    await SecureStore.setItemAsync(KEY, JSON.stringify(next));
    shareWithWidget(next);
    setConn(null);
    setError(undefined);
    setEntities({});
    setRegistry(EMPTY);
    setCreds(next);
  };

  // Entity state only changes when HA reports it; switches show the pending position meanwhile (src/optimistic.ts).
  const call = async (domain: string, service: string, data: object) => {
    if (!conn) return false;
    return callService(conn, domain, service, data).then(
      () => true,
      (e) => {
        Alert.alert('Command failed', e?.message ?? String(e));
        return false;
      },
    );
  };

  return (
    <Ctx.Provider value={{
        creds: creds ?? null,
        conn,
        status,
        error,
        entities,
        ...registry,
        save,
        call,
        reloadRegistry: () => conn && loadRegistry(conn).then(setRegistry, () => {}),
      }}>
      {children}
    </Ctx.Provider>
  );
}

export const byDomain = (entities: HassEntities, ...domains: string[]) =>
  Object.values(entities)
    .filter((e) => domains.includes(e.entity_id.split('.')[0]))
    .sort((a, b) => name(a).localeCompare(name(b)));

export const name = (e: HassEntity) => e.attributes.friendly_name ?? e.entity_id;

export const unavailable = (e?: HassEntity) => !e || e.state === 'unavailable' || e.state === 'unknown';

export const deviceName = (d?: Device) => d?.name_by_user ?? d?.name ?? undefined;

/** Alexa Media Player's Echos: speakers with no real power switch (they always carry `last_called`). */
export const isEcho = (e: HassEntity) => e.entity_id.startsWith('media_player.') && 'last_called' in e.attributes;

/** TVs and speakers. A TV added twice (Cast plus its own integration) shows once, as the one that says it's a TV:
 * that one can wake it. The Alexa phone app ("This Device") isn't a speaker. */
export function players(entities: HassEntities, devices: Record<string, Device>) {
  const best = new Map<string, HassEntity>();
  for (const e of byDomain(entities, 'media_player')) {
    if (devices[e.entity_id]?.model?.startsWith('Alexa Mobile')) continue;
    if (!isEcho(e) && !((e.attributes.supported_features ?? 0) & 128)) continue; // 128 = TURN_ON
    const key = deviceName(devices[e.entity_id]) ?? e.entity_id;
    const had = best.get(key);
    if (!had || (e.attributes.device_class === 'tv' && had.attributes.device_class !== 'tv')) best.set(key, e);
  }
  return [...best.values()];
}

export const playerOn = (e: HassEntity) => !['off', 'standby', 'unavailable', 'unknown'].includes(e.state);

/**
 * Lights and switches people control. A switch on a camera, speaker, TV, light or fan is one of its settings (Blink's
 * motion detection, an Echo's Do Not Disturb, a Govee light's music mode), not a device of its own.
 */
/** Devices with a main entity (camera, speaker/TV, light, fan): their switches are settings, not devices. */
export const parentDevices = (entities: HassEntities, devices: Record<string, Device>) =>
  new Set(Object.keys(entities).flatMap((id) => (/^(camera|media_player|light|fan|climate)\./.test(id) && devices[id] ? [devices[id].id] : [])));

export function switchables(entities: HassEntities, devices: Record<string, Device>) {
  const parent = parentDevices(entities, devices);
  return byDomain(entities, 'light', 'switch', 'fan', 'input_boolean').filter(
    (e) =>
      !e.entity_id.endsWith('_motion_detection') && // in case the registry isn't readable
      !(e.entity_id.startsWith('switch.') && parent.has(devices[e.entity_id]?.id)),
  );
}
