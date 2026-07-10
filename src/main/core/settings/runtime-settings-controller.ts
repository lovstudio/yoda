import { createRPCController } from '@/shared/ipc/rpc';
import type { RuntimeCustomConfig } from '@shared/app-settings';
import {
  getRuntimeAccountProfile,
  type AgentApiProbeResult,
  type AgentLocalUsage,
  type AgentSubscriptionAccount,
  type RuntimeAccountStatus,
  type RuntimeId,
} from '@shared/runtime-registry';
import { getLocalUsage } from './local-usage-service';
import { probeOfficialApi } from './official-api-probe-service';
import { runtimeModelCandidatesService } from './runtime-model-candidates-service';
import { runtimeOverrideSettings } from './runtime-settings-service';
import { getRuntimeSnapshot } from './runtime-snapshot-service';
import { getSubscriptionAccount } from './subscription-account-service';
import { startSubscriptionLogin } from './subscription-login-service';

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

export const runtimeSettingsController = createRPCController({
  getAll: (): Promise<Record<string, RuntimeCustomConfig>> => runtimeOverrideSettings.getAll(),

  getItem: (id: string): Promise<RuntimeCustomConfig | undefined> =>
    runtimeOverrideSettings.getItem(id),

  getItemWithMeta: (
    id: string
  ): Promise<{
    value: RuntimeCustomConfig;
    defaults: RuntimeCustomConfig;
    overrides: Partial<RuntimeCustomConfig>;
  } | null> => runtimeOverrideSettings.getItemWithMeta(id),

  updateItem: (id: string, config: Partial<RuntimeCustomConfig>): Promise<void> =>
    runtimeOverrideSettings.updateItem(id, config),

  resetItem: (id: string): Promise<void> => runtimeOverrideSettings.resetItem(id),

  resetAll: (): Promise<void> => runtimeOverrideSettings.resetAll(),

  inferNamingModelCandidates: (id: RuntimeId, args?: { forceRefresh?: boolean }) =>
    runtimeModelCandidatesService.inferNamingModelCandidates(id, args),

  getRuntimeSnapshot: (
    id: RuntimeId,
    options?: { connectionId?: string; forceRefresh?: boolean }
  ) => getRuntimeSnapshot(id, options),

  updateModelCandidatePreferences: (
    id: RuntimeId,
    args: {
      hiddenModels?: string[];
      preferredNamingModel?: string | null;
    }
  ) => runtimeModelCandidatesService.updateModelCandidatePreferences(id, args),

  getSubscriptionAccount: (id: RuntimeId): Promise<AgentSubscriptionAccount> =>
    getSubscriptionAccount(id),

  startSubscriptionLogin: (id: RuntimeId) => startSubscriptionLogin(id),

  getLocalUsage: (id: RuntimeId, args?: { forceRefresh?: boolean }): Promise<AgentLocalUsage> =>
    getLocalUsage(id, args),

  probeOfficialApi: (id: RuntimeId): Promise<AgentApiProbeResult> => probeOfficialApi(id),

  getRuntimeAccountStatus: async (id: RuntimeId): Promise<RuntimeAccountStatus> => {
    const profile = getRuntimeAccountProfile(id);
    const providerConfig = await runtimeOverrideSettings.getItem(id);
    const customEnv = providerConfig?.env ?? {};
    const envVars = [...profile.officialApi.envVars];
    const customApiEnvVars = envVars.filter((key) => customEnv[key]?.trim());
    const inheritedApiEnvVars = envVars.filter((key) => process.env[key]?.trim());

    return {
      runtimeId: id,
      officialApiEnvVars: envVars,
      configuredApiEnvVars: unique([...customApiEnvVars, ...inheritedApiEnvVars]),
      customApiEnvVars,
      inheritedApiEnvVars,
    };
  },
});
