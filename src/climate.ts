import type { SFSymbol } from 'expo-symbols';
import type { HassEntities, HassEntity } from 'home-assistant-js-websocket';

import { deviceName, type Device } from '@/ha';

// Thermostats (Ecobee over HomeKit, Nest, …) and the room sensors that come with them.

export const HVAC_MODE: Record<string, string> = {
  off: 'Off',
  heat: 'Heat',
  cool: 'Cool',
  heat_cool: 'Auto',
  auto: 'Auto',
  dry: 'Dry',
  fan_only: 'Fan',
};

const HVAC_ACTION: Record<string, string> = {
  heating: 'Heating',
  preheating: 'Heating',
  cooling: 'Cooling',
  drying: 'Drying',
  fan: 'Fan',
  defrosting: 'Defrosting',
};

const HEAT = [255, 138, 61];
const COOL = [64, 156, 255];

/** One decimal (21.5°), whole numbers without one (21°). */
export const degrees = (n?: number | null) => (n == null ? '–' : `${Math.round(n * 10) / 10}°`);

/** What the thermostat is doing right now, for a tile: working (heating or cooling) glows. */
export function climateLook(e: HassEntity) {
  const a = e.attributes;
  const action: string | undefined = a.hvac_action;
  const working = action === 'heating' || action === 'preheating' || action === 'cooling';
  const cooling = action === 'cooling' || (!working && e.state === 'cool');
  const target =
    e.state === 'off' ? undefined
    : a.temperature != null ? degrees(a.temperature)
    : a.target_temp_low != null ? `${degrees(a.target_temp_low)}–${degrees(a.target_temp_high)}`
    : undefined;
  const doing = e.state === 'off' ? 'Off' : (HVAC_ACTION[action ?? ''] ?? (action === 'idle' ? 'Idle' : HVAC_MODE[e.state] ?? e.state));
  const icon: SFSymbol = e.state === 'off' ? 'thermometer.medium' : cooling ? 'snowflake' : working ? 'flame.fill' : 'thermometer.medium';
  return {
    working,
    rgb: cooling ? COOL : HEAT,
    icon,
    current: a.current_temperature as number | undefined,
    doing,
    /** "Heating to 21.5°", "Idle · 21.5°", "Off" */
    state: target ? `${doing}${working ? ' to' : ' ·'} ${target}` : doing,
  };
}

export type Room = { key: string; name: string; temperature?: number; occupied?: boolean };

/**
 * The thermostat's rooms: its own reading first, then each remote sensor (same maker, its own device), with the
 * temperature and whether someone is there. Named by the room each is in.
 */
export function climateRooms(
  thermostat: HassEntity,
  entities: HassEntities,
  devices: Record<string, Device>,
  areas: Record<string, string>,
): Room[] {
  const own = devices[thermostat.entity_id];
  if (!own) return [];
  const byDevice = new Map<string, HassEntity[]>();
  for (const e of Object.values(entities)) {
    const d = devices[e.entity_id];
    if (d && d.manufacturer === own.manufacturer) byDevice.set(d.id, [...(byDevice.get(d.id) ?? []), e]);
  }
  const rooms: Room[] = [];
  for (const [id, list] of byDevice) {
    const climate = list.find((e) => e.entity_id.startsWith('climate.'));
    if (climate && climate !== thermostat) continue; // another thermostat
    const temp = list.find((e) => e.entity_id.startsWith('sensor.') && e.attributes.device_class === 'temperature');
    const occupancy = list.find((e) => e.entity_id.startsWith('binary_sensor.') && e.attributes.device_class === 'occupancy');
    const reading = climate ? climate.attributes.current_temperature : Number(temp?.state);
    if (!Number.isFinite(reading) && !occupancy) continue;
    const anyId = (temp ?? occupancy ?? list[0]).entity_id;
    rooms.push({
      key: id,
      name: areas[anyId] ?? deviceName(devices[anyId]) ?? 'Room',
      temperature: Number.isFinite(reading) ? reading : undefined,
      occupied: occupancy ? occupancy.state === 'on' : undefined,
    });
  }
  return rooms.sort((a, b) => (a.key === own.id ? -1 : b.key === own.id ? 1 : a.name.localeCompare(b.name)));
}

/**
 * Each room's temperature and whether anyone is in it, from sensors in that room. A camera's own temperature
 * (Blink reports the camera's insides) doesn't count.
 */
export function roomReadings(entities: HassEntities, devices: Record<string, Device>, areas: Record<string, string>) {
  const cameraDevices = new Set(Object.keys(entities).flatMap((id) => (id.startsWith('camera.') && devices[id] ? [devices[id].id] : [])));
  const rooms: Record<string, { temperature?: number; occupied?: boolean }> = {};
  for (const e of Object.values(entities)) {
    const room = areas[e.entity_id];
    if (!room || cameraDevices.has(devices[e.entity_id]?.id ?? '')) continue;
    const r = (rooms[room] ??= {});
    const cls = e.attributes.device_class;
    if (e.entity_id.startsWith('sensor.') && cls === 'temperature' && r.temperature === undefined) {
      const n = Number(e.state);
      if (e.state.trim() !== '' && Number.isFinite(n)) r.temperature = n;
    }
    if (e.entity_id.startsWith('binary_sensor.') && cls === 'occupancy' && e.state !== 'unavailable')
      r.occupied = r.occupied || e.state === 'on';
  }
  return rooms;
}
