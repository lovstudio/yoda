import { createRPCController } from '@shared/ipc/rpc';
import { trelloConnectionService } from './trello-connection-service';

export type TrelloCredentialsInput = { apiKey: string; apiToken: string };

export const trelloController = createRPCController({
  saveCredentials: async (credentials: TrelloCredentialsInput) =>
    trelloConnectionService.saveCredentials(credentials),
  checkConnection: async () => trelloConnectionService.checkConnection(),
  clearCredentials: async () => trelloConnectionService.clearCredentials(),
});
