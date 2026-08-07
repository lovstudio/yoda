import { createRPCController } from '@shared/ipc/rpc';
import { asanaConnectionService } from './asana-connection-service';

export const asanaController = createRPCController({
  saveToken: async (accessToken: string) => asanaConnectionService.saveCredentials({ accessToken }),
  checkConnection: async () => asanaConnectionService.checkConnection(),
  clearToken: async () => asanaConnectionService.clearCredentials(),
});
