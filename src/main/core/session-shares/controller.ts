import { createRPCController } from '@shared/ipc/rpc';
import { createSessionShare } from './create-session-share';

export const sessionSharesController = createRPCController({
  create: createSessionShare,
});
