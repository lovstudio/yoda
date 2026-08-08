import { createRPCController } from '@shared/ipc/rpc';
import { larkCliClient } from './lark-cli-client';

export const feishuController = createRPCController({
  startAuthorization: async () => larkCliClient.startAuthorization(),
  completeAuthorization: async () => larkCliClient.completeAuthorization(),
});
