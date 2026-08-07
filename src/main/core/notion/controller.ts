import { createRPCController } from '@shared/ipc/rpc';
import { notionConnectionService } from './notion-connection-service';

export const notionController = createRPCController({
  saveToken: async (apiToken: string) => notionConnectionService.saveCredentials({ apiToken }),
  checkConnection: async () => notionConnectionService.checkConnection(),
  clearToken: async () => notionConnectionService.clearCredentials(),
});
