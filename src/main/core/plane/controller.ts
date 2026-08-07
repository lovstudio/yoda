import { createRPCController } from '@shared/ipc/rpc';
import { planeConnectionService } from './plane-connection-service';

export type PlaneCredentialsInput = {
  apiBaseUrl: string;
  workspaceSlug: string;
  apiKey: string;
};

export const planeController = createRPCController({
  saveCredentials: async (credentials: PlaneCredentialsInput) =>
    planeConnectionService.saveCredentials(credentials),
  checkConnection: async () => planeConnectionService.checkConnection(),
  clearCredentials: async () => planeConnectionService.clearCredentials(),
});
