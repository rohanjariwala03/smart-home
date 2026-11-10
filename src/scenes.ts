import * as Haptics from 'expo-haptics';
import { callService, type Connection } from 'home-assistant-js-websocket';

import type { Creds } from '@/ha';
import { goveeKey, goveeRun, type GoveeStep } from '@/govee';
import { configRest } from '@/schedules';

// Scenes made in the app are HA scripts with ids "smarthome_scene_…": HA runs the on/off/brightness/colour
// part, so they also work from Siri, widgets, the watch and HA itself. Govee scenes (cloud only, Matter can't
// carry them) ride along in the script's variables and are applied by the app when it runs the scene.

export const SCENE_PREFIX = 'smarthome_scene_';

export type SceneStep = { entity: string; on: boolean; brightness?: number; rgb?: [number, number, number] };
export type AppScene = { name: string; steps: SceneStep[]; govee: GoveeStep[] };

export const isAppScene = (entityId: string) => entityId.startsWith(`script.${SCENE_PREFIX}`);

export function toScript(s: AppScene) {
  return {
    alias: s.name,
    description: 'Scene created in the Smart Home app',
    icon: 'mdi:palette',
    mode: 'single',
    variables: { smarthome_govee: s.govee },
    sequence: s.steps.map((x) => {
      const domain = x.entity.split('.')[0];
      const data = domain === 'light' && x.on ? { ...(x.brightness && { brightness_pct: x.brightness }), ...(x.rgb && { rgb_color: x.rgb }) } : {};
      return {
        action: `${domain}.turn_${x.on ? 'on' : 'off'}`,
        target: { entity_id: x.entity },
        ...(Object.keys(data).length && { data }),
      };
    }),
  };
}

export function fromScript(c: any): AppScene {
  return {
    name: c?.alias ?? '',
    govee: c?.variables?.smarthome_govee ?? [],
    steps: (c?.sequence ?? []).flatMap((a: any) =>
      typeof a?.target?.entity_id === 'string'
        ? [{ entity: a.target.entity_id, on: String(a.action).endsWith('turn_on'), brightness: a.data?.brightness_pct, rgb: a.data?.rgb_color }]
        : [],
    ),
  };
}

export const saveScene = (creds: Creds, id: string, s: AppScene) => configRest(creds, 'script', 'POST', id, toScript(s));
export const deleteScene = (creds: Creds, id: string) => configRest(creds, 'script', 'DELETE', id);
export const newSceneId = () => `${SCENE_PREFIX}${Date.now().toString(36)}`;

export const readScene = (conn: Connection, entityId: string) =>
  conn.sendMessagePromise<{ config: unknown }>({ type: 'script/config', entity_id: entityId }).then((r) => fromScript(r.config));

/** Run any scene or script. For the app's own scenes, then apply their Govee part (after HA has switched the light on). */
/** Runs a scene, with a success tap when it's done (an error buzz, then the error, if it fails). */
export async function runScene(conn: Connection, entityId: string) {
  try {
    await applyScene(conn, entityId);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  } catch (e) {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    throw e;
  }
}

async function applyScene(conn: Connection, entityId: string) {
  const domain = entityId.split('.')[0];
  await callService(conn, domain, 'turn_on', { entity_id: entityId });
  if (!isAppScene(entityId)) return;
  const [scene, key] = await Promise.all([readScene(conn, entityId), goveeKey()]);
  if (!key || !scene.govee.length) return;
  await new Promise((r) => setTimeout(r, 1500)); // Govee ignores scenes sent while the light is still off
  for (const g of scene.govee) await goveeRun(key, g);
}
