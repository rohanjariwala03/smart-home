import { requireOptionalNativeModule } from 'expo';

export type FoundHA = { name: string; url: string; version: string };

const native = requireOptionalNativeModule<{ find(seconds: number): Promise<FoundHA[]> }>('HaDiscovery');

/** Home Assistant servers announcing themselves on this Wi-Fi (Bonjour), with the address each one gives. */
export const findHomeAssistant = (seconds = 3): Promise<FoundHA[]> => native?.find(seconds) ?? Promise.resolve([]);
