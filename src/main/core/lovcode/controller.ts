import { createRPCController } from '@shared/ipc/rpc';
import { lovcodeService } from './lovcode-service';

export const lovcodeController = createRPCController({
  checkAvailability: () => lovcodeService.checkAvailability(true),
  search: (query: string) => lovcodeService.search(query),
});
