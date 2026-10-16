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
import { Alert } from 'react-native';

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
  call: (domain: string, service: string, data: object) => Promise<void>;
};

const KEY = 'ha-creds';

// Copy of the creds for the home-screen widget (targets/widget/Widget.swift reads it).
// Shared keychain group, readable after first unlock so the widget can refresh while locked.
const ios = Constants.expoConfig?.ios;
const shareWithWidget = (creds: Creds) =>
  SecureStore.setItemAsync('ha-widget', JSON.stringify(creds), {
    accessGroup: `${ios?.appleTeamId}.${ios?.bundleIdentifier}.shared`,
    keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
  }).catch(() => {});

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
        unsub = subscribeEntities(connection, setEntities);
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
  }, [creds]);

  const save = async (next: Creds) => {
    await SecureStore.setItemAsync(KEY, JSON.stringify(next));
    shareWithWidget(next);
    setConn(null);
    setError(undefined);
    setEntities({});
    setRegistry(EMPTY);
    setCreds(next);
  };

  // UI never updates optimistically: state only changes when HA reports it.
  const call = async (domain: string, service: string, data: object) => {
    if (!conn) return;
    await callService(conn, domain, service, data).catch((e) =>
      Alert.alert('Command failed', e?.message ?? String(e)),
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

/** Lights and switches people control: not Blink's motion-detection switches or other parts of a camera. */
export function switchables(entities: HassEntities, devices: Record<string, Device>) {
  const cameraDevices = new Set(
    Object.keys(entities).flatMap((id) => (id.startsWith('camera.') && devices[id] ? [devices[id].id] : [])),
  );
  return byDomain(entities, 'light', 'switch', 'fan', 'input_boolean').filter(
    (e) =>
      !e.entity_id.startsWith('switch.blink_proxy_') &&
      !e.entity_id.endsWith('_motion_detection') && // in case the registry isn't readable
      !cameraDevices.has(devices[e.entity_id]?.id),
  );
}
