import {
  DEFAULT_MOBILE_SYNC_MODE,
  lanSyncEnabled,
  relaySyncEnabled,
  type MobileSyncMode,
} from '@shared/mobile-sync';
import { appSettingsService } from '@main/core/settings/settings-service';
import { log } from '@main/lib/logger';
import { mobileGatewayService } from './mobile-gateway-service';
import { mobileRelayService } from './mobile-relay-service';

/** Pushes the stored sync mode into the two transports.
 *
 *  Kept out of both services so neither has to know about settings, and so the
 *  startup path and the RPC setter apply the mode through exactly one place. */
export function applyMobileSyncMode(mode: MobileSyncMode): void {
  mobileGatewayService.setLanSyncEnabled(lanSyncEnabled(mode));
  mobileRelayService.setSyncEnabled(relaySyncEnabled(mode));
}

export async function getMobileSyncMode(): Promise<MobileSyncMode> {
  const settings = await appSettingsService.get('mobileSync');
  return settings.mode;
}

export async function setMobileSyncMode(mode: MobileSyncMode): Promise<MobileSyncMode> {
  await appSettingsService.update('mobileSync', { mode });
  applyMobileSyncMode(mode);
  return mode;
}

/** Runs before either transport initializes so a relay-only desktop never
 *  briefly answers the LAN, and a LAN-only desktop never opens a Relay socket. */
export async function initializeMobileSyncMode(): Promise<void> {
  try {
    applyMobileSyncMode(await getMobileSyncMode());
  } catch (error) {
    log.warn('MobileSync: failed to read stored sync mode, using default', error);
    applyMobileSyncMode(DEFAULT_MOBILE_SYNC_MODE);
  }
}
