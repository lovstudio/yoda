import { createRPCController } from '@shared/ipc/rpc';
import { mondayConnectionService } from './monday-connection-service';

export const mondayController = createRPCController({
  saveToken: async (apiToken: string) => mondayConnectionService.saveCredentials({ apiToken }),
  checkConnection: async () => mondayConnectionService.checkConnection(),
  clearToken: async () => mondayConnectionService.clearCredentials(),
});
