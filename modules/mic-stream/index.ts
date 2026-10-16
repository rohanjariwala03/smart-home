import { NativeModule, requireNativeModule } from 'expo';

export type MicStatus = { type: 'started' | 'listening' | 'stopped' | 'error'; message?: string };

declare class MicStreamModule extends NativeModule<{ onStatus: (status: MicStatus) => void }> {
  /** Opens the push-to-talk WebSocket and streams the microphone to it. */
  start(url: string): Promise<void>;
  stop(): Promise<void>;
}

export default requireNativeModule<MicStreamModule>('MicStream');
