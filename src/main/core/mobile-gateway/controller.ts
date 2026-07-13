import { createRPCController } from '@shared/ipc/rpc';
import { mobileGatewayService } from './mobile-gateway-service';
import { mobileRelayService } from './mobile-relay-service';

export const mobileGatewayController = createRPCController({
  getConnectionInfo: () => mobileGatewayService.getConnectionInfo(),
  getRelayStatus: () => mobileRelayService.getStatus(),
  enableRelay: (deviceName?: string) => mobileRelayService.enable(deviceName),
  createRelayPairing: () => mobileRelayService.createPairing(),
  revokeRelay: async () => {
    await mobileRelayService.revoke();
    return { success: true };
  },
});
