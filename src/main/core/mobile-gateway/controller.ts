import { createRPCController } from '@shared/ipc/rpc';
import { isMobileSyncMode, type MobileSyncMode } from '@shared/mobile-sync';
import { mobileGatewayService } from './mobile-gateway-service';
import { mobileRelayService } from './mobile-relay-service';
import { getMobileSyncMode, setMobileSyncMode } from './mobile-sync-mode';

export const mobileGatewayController = createRPCController({
  getConnectionInfo: () => mobileGatewayService.getConnectionInfo(),
  getRelayStatus: () => mobileRelayService.getStatus(),
  getSyncMode: () => getMobileSyncMode(),
  setSyncMode: (mode: MobileSyncMode) => {
    if (!isMobileSyncMode(mode)) throw new Error(`Unknown mobile sync mode: ${String(mode)}`);
    return setMobileSyncMode(mode);
  },
  enableRelay: async (deviceName?: string) => {
    // Pairing over Relay is only meaningful if the Relay transport is allowed,
    // so a LAN-only desktop opts into `both` rather than silently pairing a
    // device it will never answer.
    if ((await getMobileSyncMode()) === 'lan') await setMobileSyncMode('both');
    return mobileRelayService.enable(deviceName);
  },
  createRelayPairing: () => mobileRelayService.createPairing(),
  revokeRelay: async () => {
    await mobileRelayService.revoke();
    return { success: true };
  },
});
