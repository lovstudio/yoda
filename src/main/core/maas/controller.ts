import { createRPCController } from '@shared/ipc/rpc';
import type { MaasConnectInput, MaasInvocationFilterKind, MaasPlatformId } from '@shared/maas';
import { maasService } from './maas-service';

async function listConnections() {
  return maasService.listConnections();
}

async function connectPlatform(input: MaasConnectInput) {
  return maasService.connectPlatform(input);
}

async function disconnectPlatform(platformId: MaasPlatformId) {
  return maasService.disconnectPlatform(platformId);
}

async function listInvocationRecords(args: {
  platformId: MaasPlatformId;
  kind: MaasInvocationFilterKind;
  offset?: number;
  limit?: number;
  forceRefresh?: boolean;
}) {
  return maasService.listInvocationRecords(args);
}

export const maasController = createRPCController({
  listConnections,
  connectPlatform,
  disconnectPlatform,
  listInvocationRecords,
});
