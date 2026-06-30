import { createRPCController } from '@shared/ipc/rpc';
import type {
  MaasConnectInput,
  MaasInvocationFilterKind,
  MaasPlatformId,
  MaasUsageSummaryInput,
} from '@shared/maas';
import { maasService } from './maas-service';

async function listConnections() {
  return maasService.listConnections();
}

async function listPlatformDescriptions(args?: { forceRefresh?: boolean }) {
  return maasService.listPlatformDescriptions(!!args?.forceRefresh);
}

async function getPlatformInfoSnapshot(args: {
  platformId: MaasPlatformId;
  forceRefresh?: boolean;
}) {
  return maasService.getPlatformInfoSnapshot(args.platformId, !!args.forceRefresh);
}

async function connectPlatform(input: MaasConnectInput) {
  return maasService.connectPlatform(input);
}

async function disconnectPlatform(platformId: MaasPlatformId) {
  return maasService.disconnectPlatform(platformId);
}

async function checkConnection(platformId: MaasPlatformId) {
  return maasService.checkConnection(platformId);
}

async function copyStoredApiKey(platformId: MaasPlatformId) {
  return maasService.copyStoredApiKeyToClipboard(platformId);
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

async function getUsageSummary(args: MaasUsageSummaryInput) {
  return maasService.getUsageSummary(args);
}

export const maasController = createRPCController({
  listConnections,
  listPlatformDescriptions,
  getPlatformInfoSnapshot,
  connectPlatform,
  disconnectPlatform,
  checkConnection,
  copyStoredApiKey,
  listInvocationRecords,
  getUsageSummary,
});
