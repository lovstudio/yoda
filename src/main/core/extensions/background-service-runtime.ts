import type { YodaExtensionRuntimeStatus } from '@shared/extensions';

export interface BackgroundServiceRuntime {
  getStatus(): YodaExtensionRuntimeStatus;
  start(): Promise<YodaExtensionRuntimeStatus>;
  stop(): Promise<void>;
}
