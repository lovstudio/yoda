import { createRPCController } from '@shared/ipc/rpc';
import type {
  MaasConnectInput,
  MaasCopyStoredApiKeyInput,
  MaasDuplicateProfileInput,
  MaasInvocationFilterKind,
  MaasPlatformId,
  MaasSetCodexClientSyncInput,
  MaasSetGlobalBindingInput,
  MaasSetRuntimeBindingInput,
  MaasUsageSummaryInput,
} from '@shared/maas';
import { ccSwitchIntegrationService } from './cc-switch-integration-service';
import { cliProxyApiManagedService } from './cliproxyapi-managed-service';
import { liteLlmManagedService } from './litellm-managed-service';
import { maasService } from './maas-service';
import { maasManagedGatewayStarsService } from './managed-gateway-stars';
import { newApiManagedService } from './new-api-managed-service';

async function listConnections() {
  return maasService.listConnections();
}

async function inspectProfileWebsite(websiteUrl: string) {
  return maasService.inspectProfileWebsite(websiteUrl);
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

async function duplicateProfile(input: MaasDuplicateProfileInput) {
  return maasService.duplicateProfile(input);
}

async function reorderConnections(platformIds: MaasPlatformId[]) {
  return maasService.reorderConnections(platformIds);
}

async function checkConnection(platformId: MaasPlatformId) {
  return maasService.checkConnection(platformId);
}

async function copyStoredApiKey(input: MaasCopyStoredApiKeyInput) {
  return maasService.copyStoredApiKeyToClipboard(input);
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

async function listRuntimeBindings() {
  return maasService.listRuntimeBindings();
}

async function setRuntimeBinding(input: MaasSetRuntimeBindingInput) {
  return maasService.setRuntimeBinding(input);
}

async function getGlobalBinding() {
  return maasService.getGlobalBinding();
}

async function setGlobalBinding(input: MaasSetGlobalBindingInput) {
  return maasService.setGlobalBinding(input);
}

async function getCodexClientSyncStatus() {
  return maasService.getCodexClientSyncStatus();
}

async function setCodexClientSync(input: MaasSetCodexClientSyncInput) {
  return maasService.setCodexClientSync(input);
}

async function clearCodexClientSync() {
  return maasService.clearCodexClientSync();
}

export const maasController = createRPCController({
  listConnections,
  inspectProfileWebsite,
  listPlatformDescriptions,
  getPlatformInfoSnapshot,
  connectPlatform,
  disconnectPlatform,
  duplicateProfile,
  reorderConnections,
  checkConnection,
  copyStoredApiKey,
  listInvocationRecords,
  getUsageSummary,
  listRuntimeBindings,
  setRuntimeBinding,
  getGlobalBinding,
  setGlobalBinding,
  getCodexClientSyncStatus,
  setCodexClientSync,
  clearCodexClientSync,
  listManagedGatewayStars: (args?: { forceRefresh?: boolean }) =>
    maasManagedGatewayStarsService.list(!!args?.forceRefresh),
  getLiteLlmManagedStatus: () => liteLlmManagedService.getStatus(),
  installLiteLlm: () => liteLlmManagedService.install(),
  startLiteLlm: () => liteLlmManagedService.start(),
  stopLiteLlm: () => liteLlmManagedService.stop(),
  startDockerForLiteLlm: () => liteLlmManagedService.startDockerDesktop(),
  copyLiteLlmAdminPassword: () => liteLlmManagedService.copyAdminPassword(),
  openLiteLlmAdmin: () => liteLlmManagedService.openAdmin(),
  getNewApiManagedStatus: () => newApiManagedService.getStatus(),
  installNewApi: () => newApiManagedService.install(),
  initializeNewApi: () => newApiManagedService.initialize(),
  startNewApi: () => newApiManagedService.start(),
  stopNewApi: () => newApiManagedService.stop(),
  startDockerForNewApi: () => newApiManagedService.startDockerDesktop(),
  copyNewApiAdminPassword: () => newApiManagedService.copyAdminPassword(),
  openNewApiAdmin: () => newApiManagedService.openAdmin(),
  getCliProxyApiManagedStatus: () => cliProxyApiManagedService.getStatus(),
  installCliProxyApi: () => cliProxyApiManagedService.install(),
  startCliProxyApi: () => cliProxyApiManagedService.start(),
  stopCliProxyApi: () => cliProxyApiManagedService.stop(),
  copyCliProxyApiManagementKey: () => cliProxyApiManagedService.copyManagementKey(),
  openCliProxyApiAdmin: () => cliProxyApiManagedService.openAdmin(),
  getCcSwitchIntegrationStatus: () => ccSwitchIntegrationService.getStatus(),
  installCcSwitch: () => ccSwitchIntegrationService.install(),
  openCcSwitch: () => ccSwitchIntegrationService.open(),
});
