import { clipboard, net } from 'electron';
import type { MaasSettings, RuntimeCustomConfig } from '@shared/app-settings';
import {
  MAAS_PLATFORM_IDS,
  MAAS_PLATFORMS,
  supportsMaasPlatformForRuntime,
  type MaasConnectInput,
  type MaasConnection,
  type MaasConnectionCheckResult,
  type MaasInvocationFilterKind,
  type MaasInvocationKind,
  type MaasInvocationPage,
  type MaasInvocationRecord,
  type MaasPlatformConnection,
  type MaasPlatformId,
  type MaasPlatformInfoSnapshot,
  type MaasPlatformOfficialDescription,
  type MaasRuntimeBinding,
  type MaasRuntimeBindingStatus,
  type MaasSetRuntimeBindingInput,
  type MaasUsageSummary,
  type MaasUsageSummaryInput,
} from '@shared/maas';
import { isValidRuntimeId, RUNTIME_IDS, type RuntimeId } from '@shared/runtime-registry';
import { TTLCache } from '@main/core/utils/ttl-cache';
import { log } from '@main/lib/logger';
import { telemetryService } from '@main/lib/telemetry';
import { encryptedAppSecretsStore } from '../secrets/encrypted-app-secrets-store';
import { runtimeOverrideSettings } from '../settings/runtime-settings-service';
import { appSettingsService } from '../settings/settings-service';
import {
  extractMaasPlatformInfoSnapshot,
  fallbackMaasPlatformInfoSnapshot,
  MAAS_PLATFORM_INFO_SNAPSHOT_VERSION,
  toMaasPlatformOfficialDescription,
} from './platform-description';
import { getMaasPlatformInfoSnapshot, setMaasPlatformInfoSnapshot } from './platform-info-store';
import { resolveRestoredMaasRuntimeConfig, supportsMaasRuntimeBinding } from './runtime-env';

const SECRET_PREFIX = 'yoda-maas-token';
const INFERENCE_SECRET_PREFIX = 'yoda-maas-inference-token';
const REAL_RECORDS_CACHE_TTL_MS = 30_000;
const PLATFORM_INFO_CACHE_TTL_MS = 24 * 60 * 60 * 1_000;
const PLATFORM_DESCRIPTION_TIMEOUT_MS = 10_000;
const ZENMUX_MODEL_CATALOG_CACHE_TTL_MS = 24 * 60 * 60 * 1_000;
const ZENMUX_MODEL_CATALOG_TIMEOUT_MS = 10_000;
const ZENMUX_USAGE_LOOKBACK_DAYS = 60;
const ZENMUX_MAX_MODELS_PER_BUCKET = 50;

type ZenmuxStatisticsMetric = 'tokens' | 'cost';

type ZenmuxTimeseriesEntry = {
  model?: string;
  label?: string;
  value?: number;
};

type ZenmuxTimeseriesBucket = {
  date?: string;
  models?: ZenmuxTimeseriesEntry[];
};

type ZenmuxTimeseriesResponse = {
  success?: boolean;
  data?: {
    metric?: string;
    starting_at?: string;
    ending_at?: string;
    series?: ZenmuxTimeseriesBucket[];
  };
  error?: string | { message?: string };
  message?: string;
};

type ZenmuxCatalogModel = {
  id?: string;
  object?: string;
  input_modalities?: string[];
  output_modalities?: string[];
};

type ZenmuxModelsResponse = {
  data?: ZenmuxCatalogModel[];
  error?: string | { message?: string };
  message?: string;
};

type ZenmuxErrorBody = {
  error?: string | { message?: string };
  message?: string;
};

type RealRecordsResult = Pick<MaasInvocationPage, 'source' | 'fetchedAt' | 'period'> & {
  records: MaasInvocationRecord[];
};

function isMaasPlatformId(value: string): value is MaasPlatformId {
  return (MAAS_PLATFORM_IDS as readonly string[]).includes(value);
}

function secretKey(platformId: MaasPlatformId): string {
  return `${SECRET_PREFIX}:${platformId}`;
}

function inferenceSecretKey(platformId: MaasPlatformId): string {
  return `${INFERENCE_SECRET_PREFIX}:${platformId}`;
}

function keyFingerprint(apiKey: string): string {
  const trimmed = apiKey.trim();
  if (trimmed.length <= 4) return trimmed;
  return `${trimmed.slice(0, 2)}...${trimmed.slice(-2)}`;
}

function defaultConnection(platformId: MaasPlatformId): MaasConnection {
  const platform = MAAS_PLATFORMS[platformId];
  return {
    platformId,
    displayName: platform.name,
    endpoint: platform.defaultEndpoint,
    keyFingerprint: null,
    inferenceKeyFingerprint: null,
    connectedAt: null,
    lastCheckedAt: null,
    connected: false,
    error: null,
  };
}

function toConnection(
  saved: MaasPlatformConnection | undefined,
  platformId: MaasPlatformId
): MaasConnection {
  if (!saved) return defaultConnection(platformId);
  return {
    ...saved,
    connected: true,
    error: null,
  };
}

function upsertConnection(
  connections: MaasSettings['connections'],
  connection: MaasPlatformConnection
): MaasSettings['connections'] {
  const withoutCurrent = connections.filter((item) => item.platformId !== connection.platformId);
  return [connection, ...withoutCurrent];
}

function getConnectedPlatform(
  settings: MaasSettings,
  platformId: MaasPlatformId
): MaasPlatformConnection | undefined {
  return settings.connections.find((item) => item.platformId === platformId);
}

function normalizePageArgs(args: {
  platformId: MaasPlatformId;
  kind: MaasInvocationFilterKind;
  offset?: number;
  limit?: number;
}): { offset: number; limit: number } {
  return {
    offset: Math.max(0, Number.isFinite(args.offset) ? Math.floor(args.offset ?? 0) : 0),
    limit: Math.min(
      50,
      Math.max(1, Number.isFinite(args.limit) ? Math.floor(args.limit ?? 24) : 24)
    ),
  };
}

function utcDateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function zenmuxUsageDateRange(): { startingAt: string; endingAt: string } {
  const now = new Date();
  const endingAt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  endingAt.setUTCDate(endingAt.getUTCDate() - 1);
  const startingAt = new Date(endingAt);
  startingAt.setUTCDate(startingAt.getUTCDate() - ZENMUX_USAGE_LOOKBACK_DAYS + 1);

  return {
    startingAt: utcDateString(startingAt),
    endingAt: utcDateString(endingAt),
  };
}

function zenmuxManagementUrl(endpoint: string, path: string): URL {
  const defaultEndpoint = MAAS_PLATFORMS.zenmux.defaultEndpoint;
  const trimmedEndpoint = (endpoint.trim() || defaultEndpoint).replace(/\/+$/, '');
  const managementBase = trimmedEndpoint.endsWith('/management')
    ? trimmedEndpoint
    : `${trimmedEndpoint}/management`;

  return new URL(`${managementBase}/${path.replace(/^\/+/, '')}`);
}

function getErrorMessage(body: ZenmuxErrorBody | null, fallback: string): string {
  if (!body) return fallback;
  if (typeof body.error === 'string' && body.error.trim()) return body.error;
  if (typeof body.error === 'object' && body.error.message?.trim()) return body.error.message;
  if (body.message?.trim()) return body.message;
  return fallback;
}

function inferInvocationKind(model: string): MaasInvocationKind {
  const value = model.toLowerCase();
  if (
    value.includes('embedding') ||
    value.includes('embed') ||
    value.includes('bge') ||
    value.includes('jina')
  ) {
    return 'embedding';
  }
  if (
    value.includes('image') ||
    value.includes('imagen') ||
    value.includes('dall-e') ||
    value.includes('flux') ||
    value.includes('sdxl')
  ) {
    return 'image';
  }
  if (
    value.includes('video') ||
    value.includes('veo') ||
    value.includes('kling') ||
    value.includes('runway') ||
    value.includes('wan-')
  ) {
    return 'video';
  }
  return 'text';
}

function costKey(date: string, model: string): string {
  return `${date}:${model}`;
}

function recordDate(date: string): string {
  return new Date(`${date}T00:00:00.000Z`).toISOString();
}

function buildZenmuxUsageRecords(
  tokens: ZenmuxTimeseriesResponse['data'],
  costs: ZenmuxTimeseriesResponse['data']
): MaasInvocationRecord[] {
  const costByDateAndModel = new Map<string, number>();
  for (const bucket of costs?.series ?? []) {
    if (!bucket.date) continue;
    for (const model of bucket.models ?? []) {
      if (!model.model || typeof model.value !== 'number') continue;
      costByDateAndModel.set(costKey(bucket.date, model.model), model.value);
    }
  }

  const records: MaasInvocationRecord[] = [];
  for (const bucket of tokens?.series ?? []) {
    if (!bucket.date) continue;

    for (const model of bucket.models ?? []) {
      if (!model.model || typeof model.value !== 'number') continue;

      const tokenCount = Math.round(model.value);
      const costUsd = costByDateAndModel.get(costKey(bucket.date, model.model)) ?? null;
      const label = model.label?.trim() || model.model;
      const kind = inferInvocationKind(model.model);
      const provider = model.model.includes('/') ? model.model.split('/')[0]! : 'ZenMux';

      records.push({
        id: `zenmux:${bucket.date}:${model.model}`,
        platformId: 'zenmux',
        kind,
        title: label,
        prompt: '',
        outputSummary: '',
        model: model.model,
        provider,
        createdAt: recordDate(bucket.date),
        status: 'succeeded',
        previewUrl: null,
        inputTokens: tokenCount,
        outputTokens: null,
        costUsd,
        latencyMs: null,
        durationMs: null,
        assetCount: null,
        dimensions: null,
      });
    }
  }

  return records.sort((left, right) => {
    const dateOrder = new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
    if (dateOrder !== 0) return dateOrder;
    return (right.inputTokens ?? 0) - (left.inputTokens ?? 0);
  });
}

function normalizeHints(hints: readonly string[] | undefined): string[] {
  return (hints ?? []).map((hint) => hint.trim().toLowerCase()).filter(Boolean);
}

function matchesHints(
  record: MaasInvocationRecord,
  providerHints: string[],
  modelHints: string[]
): boolean {
  const provider = record.provider.toLowerCase();
  const model = record.model.toLowerCase();
  const providerMatches =
    providerHints.length === 0 ||
    providerHints.some((hint) => provider.includes(hint) || model.includes(hint));
  const modelMatches = modelHints.length === 0 || modelHints.some((hint) => model.includes(hint));
  return providerMatches && modelMatches;
}

function sumNullable(
  records: MaasInvocationRecord[],
  pick: (record: MaasInvocationRecord) => number | null
): number | null {
  let total = 0;
  let hasValue = false;
  for (const record of records) {
    const value = pick(record);
    if (typeof value !== 'number') continue;
    total += value;
    hasValue = true;
  }
  return hasValue ? total : null;
}

function isFreshPlatformInfoSnapshot(
  snapshot: MaasPlatformInfoSnapshot,
  platform: (typeof MAAS_PLATFORMS)[MaasPlatformId]
): boolean {
  if (snapshot.version !== MAAS_PLATFORM_INFO_SNAPSHOT_VERSION) return false;
  if (snapshot.sourceUrl !== (platform.officialDescriptionUrl || platform.docsUrl)) return false;
  if (!snapshot.fetchedAt) return false;

  const fetchedAt = new Date(snapshot.fetchedAt).getTime();
  if (!Number.isFinite(fetchedAt)) return false;
  return Date.now() - fetchedAt < PLATFORM_INFO_CACHE_TTL_MS;
}

export class MaasService {
  private readonly recordsCacheByConnection = new Map<string, TTLCache<RealRecordsResult>>();
  private readonly platformInfoCacheById = new Map<
    MaasPlatformId,
    TTLCache<MaasPlatformInfoSnapshot>
  >();
  private readonly zenmuxModelCatalogCache = new TTLCache<string[]>(
    ZENMUX_MODEL_CATALOG_CACHE_TTL_MS
  );

  async listConnections(): Promise<MaasConnection[]> {
    const settings = await appSettingsService.get('maas');
    return Promise.all(
      MAAS_PLATFORM_IDS.map(async (platformId) => {
        const saved = getConnectedPlatform(settings, platformId);
        if (!saved) return defaultConnection(platformId);

        const apiKey = await encryptedAppSecretsStore.getSecret(secretKey(platformId));
        const inferenceApiKey = await encryptedAppSecretsStore.getSecret(
          platformId === 'zenmux' ? inferenceSecretKey(platformId) : secretKey(platformId)
        );
        const connection = {
          ...saved,
          keyFingerprint: apiKey ? keyFingerprint(apiKey) : saved.keyFingerprint,
          inferenceKeyFingerprint: inferenceApiKey
            ? keyFingerprint(inferenceApiKey)
            : saved.inferenceKeyFingerprint,
        };
        const hasCredential = Boolean(apiKey || inferenceApiKey);
        return {
          ...connection,
          connected: hasCredential,
          error: hasCredential
            ? null
            : 'Credentials are not synced. Reconnect this MaaS platform on this device.',
        };
      })
    );
  }

  async listRuntimeBindings(): Promise<MaasRuntimeBindingStatus[]> {
    const settings = await appSettingsService.get('maas');
    const statuses = await Promise.all(
      RUNTIME_IDS.filter((runtimeId) => supportsMaasRuntimeBinding(runtimeId)).map(
        async (runtimeId): Promise<MaasRuntimeBindingStatus> => {
          const config = await runtimeOverrideSettings.getItem(runtimeId);
          const savedBinding = settings.runtimeBindings.find(
            (binding) => binding.runtimeId === runtimeId
          );
          const configuredPlatformId = config?.maasPlatformId ?? savedBinding?.platformId ?? null;
          const credentials =
            configuredPlatformId && supportsMaasPlatformForRuntime(runtimeId, configuredPlatformId)
              ? await this.getInferenceCredentials(configuredPlatformId)
              : undefined;
          const effective =
            config?.authProvider === 'yoda-maas' &&
            configuredPlatformId !== null &&
            credentials !== undefined;

          return {
            runtimeId,
            platformId: configuredPlatformId,
            supported: true,
            bound: savedBinding !== undefined || config?.authProvider === 'yoda-maas',
            effective,
            connected: credentials !== undefined,
            enabledAt: savedBinding?.enabledAt ?? null,
          };
        }
      )
    );

    return statuses;
  }

  async setRuntimeBinding(
    input: MaasSetRuntimeBindingInput
  ): Promise<{ success: boolean; error?: string }> {
    try {
      if (!isValidRuntimeId(input.runtimeId) || !supportsMaasRuntimeBinding(input.runtimeId)) {
        return { success: false, error: 'This Agent Client does not support MaaS switching.' };
      }
      if (!isMaasPlatformId(input.platformId)) {
        return { success: false, error: 'Unsupported MaaS platform.' };
      }
      if (!supportsMaasPlatformForRuntime(input.runtimeId, input.platformId)) {
        return {
          success: false,
          error: 'This MaaS platform does not expose a protocol compatible with the Client.',
        };
      }

      const settings = await appSettingsService.get('maas');
      const existingBinding = settings.runtimeBindings.find(
        (binding) => binding.runtimeId === input.runtimeId
      );
      const currentConfig = (await runtimeOverrideSettings.getItem(input.runtimeId)) ?? {};

      if (input.enabled) {
        if (!(await this.getInferenceCredentials(input.platformId))) {
          return {
            success: false,
            error: 'Connect the MaaS platform and save an API key before enabling a Client.',
          };
        }

        const binding: MaasRuntimeBinding = {
          runtimeId: input.runtimeId,
          platformId: input.platformId,
          previousAuthProvider:
            existingBinding?.previousAuthProvider ?? currentConfig.authProvider ?? null,
          previousMaasPlatformId:
            existingBinding?.previousMaasPlatformId ?? currentConfig.maasPlatformId ?? null,
          enabledAt: existingBinding?.enabledAt ?? new Date().toISOString(),
        };
        await runtimeOverrideSettings.updateItem(input.runtimeId, {
          ...currentConfig,
          authProvider: 'yoda-maas',
          maasPlatformId: input.platformId,
        });
        await appSettingsService.update('maas', {
          selectedPlatformId: input.platformId,
          runtimeBindings: [
            binding,
            ...settings.runtimeBindings.filter((item) => item.runtimeId !== input.runtimeId),
          ],
        });
        return { success: true };
      }

      if (existingBinding && existingBinding.platformId !== input.platformId) {
        return { success: true };
      }

      await this.restoreRuntimeConfig(
        input.runtimeId,
        currentConfig,
        existingBinding,
        input.platformId
      );
      await appSettingsService.update('maas', {
        runtimeBindings: settings.runtimeBindings.filter(
          (item) => item.runtimeId !== input.runtimeId
        ),
      });
      return { success: true };
    } catch (error) {
      log.error('Failed to update MaaS runtime binding:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to update MaaS runtime binding.',
      };
    }
  }

  async getRuntimeInferenceCredentials(
    runtimeId: RuntimeId,
    platformId?: MaasPlatformId
  ): Promise<{ platformId: MaasPlatformId; endpoint: string; apiKey: string } | undefined> {
    if (!supportsMaasRuntimeBinding(runtimeId)) return undefined;
    const settings = await appSettingsService.get('maas');
    const selectedPlatformId =
      platformId ??
      settings.runtimeBindings.find((binding) => binding.runtimeId === runtimeId)?.platformId ??
      settings.selectedPlatformId;
    if (!supportsMaasPlatformForRuntime(runtimeId, selectedPlatformId)) return undefined;
    const credentials = await this.getInferenceCredentials(selectedPlatformId);
    return credentials ? { platformId: selectedPlatformId, ...credentials } : undefined;
  }

  private async restoreRuntimeConfig(
    runtimeId: RuntimeId,
    currentConfig: RuntimeCustomConfig,
    binding: MaasRuntimeBinding | undefined,
    platformId: MaasPlatformId
  ): Promise<void> {
    if (
      !binding &&
      (currentConfig.authProvider !== 'yoda-maas' || currentConfig.maasPlatformId !== platformId)
    ) {
      return;
    }

    await runtimeOverrideSettings.updateItem(
      runtimeId,
      resolveRestoredMaasRuntimeConfig(currentConfig, binding)
    );
  }

  async listPlatformDescriptions(forceRefresh = false): Promise<MaasPlatformOfficialDescription[]> {
    const snapshots = await Promise.all(
      MAAS_PLATFORM_IDS.map((platformId) => this.getPlatformInfoSnapshot(platformId, forceRefresh))
    );

    return snapshots.map(toMaasPlatformOfficialDescription);
  }

  async getPlatformInfoSnapshot(
    platformId: MaasPlatformId,
    forceRefresh = false
  ): Promise<MaasPlatformInfoSnapshot> {
    if (!isMaasPlatformId(platformId)) {
      throw new Error('Unsupported MaaS platform.');
    }

    let cache = this.platformInfoCacheById.get(platformId);
    if (!cache) {
      cache = new TTLCache<MaasPlatformInfoSnapshot>(PLATFORM_INFO_CACHE_TTL_MS);
      this.platformInfoCacheById.set(platformId, cache);
    }
    if (forceRefresh) {
      cache.invalidate();
    }

    return cache.get(() => this.loadPlatformInfoSnapshot(platformId, forceRefresh));
  }

  /**
   * Endpoint + stored API key for a connected platform, for features that call
   * the platform's inference APIs directly (e.g. AI Lab image generation).
   */
  async getInferenceCredentials(
    platformId: MaasPlatformId
  ): Promise<{ endpoint: string; apiKey: string } | undefined> {
    const settings = await appSettingsService.get('maas');
    const connection = getConnectedPlatform(settings, platformId);
    if (!connection) return undefined;
    const apiKey = await encryptedAppSecretsStore.getSecret(
      platformId === 'zenmux' ? inferenceSecretKey(platformId) : secretKey(platformId)
    );
    if (!apiKey) return undefined;
    return { endpoint: connection.endpoint, apiKey };
  }

  async copyStoredApiKeyToClipboard(
    platformId: MaasPlatformId
  ): Promise<{ success: boolean; error?: string }> {
    try {
      if (!isMaasPlatformId(platformId)) {
        return { success: false, error: 'Unsupported MaaS platform.' };
      }

      const settings = await appSettingsService.get('maas');
      const connection = getConnectedPlatform(settings, platformId);
      if (!connection) {
        return { success: false, error: 'Platform is not connected.' };
      }

      const apiKey = await encryptedAppSecretsStore.getSecret(secretKey(platformId));
      if (!apiKey) {
        return {
          success: false,
          error: 'Stored MaaS API key is missing. Paste the key again to reconnect.',
        };
      }

      clipboard.writeText(apiKey);
      return { success: true };
    } catch (error) {
      log.error('Failed to copy MaaS API key:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to copy MaaS API key.',
      };
    }
  }

  async connectPlatform(
    input: MaasConnectInput
  ): Promise<{ success: boolean; connection?: MaasConnection; error?: string }> {
    try {
      if (!isMaasPlatformId(input.platformId)) {
        return { success: false, error: 'Unsupported MaaS platform.' };
      }

      const platform = MAAS_PLATFORMS[input.platformId];
      const settings = await appSettingsService.get('maas');
      const existing = getConnectedPlatform(settings, input.platformId);
      const apiKey = input.apiKey?.trim() ?? '';
      const inferenceApiKey = input.inferenceApiKey?.trim() ?? '';
      let retainedApiKey: string | null = null;
      if (
        !apiKey &&
        !existing?.keyFingerprint &&
        !(input.platformId === 'zenmux' && inferenceApiKey)
      ) {
        return { success: false, error: 'A MaaS API key is required.' };
      }
      if (!apiKey && existing?.keyFingerprint) {
        const existingApiKey = await encryptedAppSecretsStore.getSecret(
          secretKey(input.platformId)
        );
        if (!existingApiKey) {
          return {
            success: false,
            error: 'Stored MaaS API key is missing. Paste the key again to reconnect.',
          };
        }
        retainedApiKey = existingApiKey;
      }

      const now = new Date().toISOString();
      const connection: MaasPlatformConnection = {
        platformId: input.platformId,
        displayName: input.displayName?.trim() || platform.name,
        endpoint: input.endpoint?.trim() || platform.defaultEndpoint,
        keyFingerprint: apiKey
          ? keyFingerprint(apiKey)
          : retainedApiKey
            ? keyFingerprint(retainedApiKey)
            : (existing?.keyFingerprint ?? null),
        inferenceKeyFingerprint:
          input.platformId === 'zenmux'
            ? inferenceApiKey
              ? keyFingerprint(inferenceApiKey)
              : (existing?.inferenceKeyFingerprint ?? null)
            : apiKey
              ? keyFingerprint(apiKey)
              : retainedApiKey
                ? keyFingerprint(retainedApiKey)
                : (existing?.inferenceKeyFingerprint ?? existing?.keyFingerprint ?? null),
        connectedAt: existing?.connectedAt ?? now,
        lastCheckedAt: now,
      };

      if (apiKey) {
        await encryptedAppSecretsStore.setSecret(secretKey(input.platformId), apiKey);
      }
      if (input.platformId === 'zenmux' && inferenceApiKey) {
        await encryptedAppSecretsStore.setSecret(
          inferenceSecretKey(input.platformId),
          inferenceApiKey
        );
      }

      await appSettingsService.update('maas', {
        selectedPlatformId: input.platformId,
        connections: upsertConnection(settings.connections, connection),
      });
      this.recordsCacheByConnection.clear();
      telemetryService.capture('maas_platform_connected', { platform: input.platformId });

      return { success: true, connection: toConnection(connection, input.platformId) };
    } catch (error) {
      log.error('Failed to connect MaaS platform:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to connect MaaS platform.',
      };
    }
  }

  async checkConnection(platformId: MaasPlatformId): Promise<MaasConnectionCheckResult> {
    const checkedAt = new Date().toISOString();
    try {
      if (!isMaasPlatformId(platformId)) {
        return { ok: false, error: 'Unsupported MaaS platform.', checkedAt };
      }

      const settings = await appSettingsService.get('maas');
      const connection = getConnectedPlatform(settings, platformId);
      if (!connection) {
        return { ok: false, error: 'Platform is not connected.', checkedAt };
      }

      if (platformId !== 'zenmux') {
        return {
          ok: false,
          error: `${MAAS_PLATFORMS[platformId].name} connectivity checks are not available yet.`,
          checkedAt,
        };
      }

      const apiKey = await encryptedAppSecretsStore.getSecret(secretKey(platformId));
      if (!apiKey) {
        return {
          ok: false,
          error: 'Stored API key is missing. Reconnect the platform to restore it.',
          checkedAt,
        };
      }

      // A real Management API round-trip: the cheapest call that exercises
      // both the endpoint and the key.
      await this.fetchZenmuxTimeseries(connection.endpoint, apiKey, 'cost');
      return { ok: true, error: null, checkedAt };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'Connectivity check failed.',
        checkedAt,
      };
    }
  }

  async disconnectPlatform(
    platformId: MaasPlatformId
  ): Promise<{ success: boolean; error?: string }> {
    try {
      if (!isMaasPlatformId(platformId)) {
        return { success: false, error: 'Unsupported MaaS platform.' };
      }

      const settings = await appSettingsService.get('maas');
      const connections = settings.connections.filter((item) => item.platformId !== platformId);
      const selectedPlatformId =
        settings.selectedPlatformId === platformId
          ? (connections[0]?.platformId ?? MAAS_PLATFORMS.zenmux.id)
          : settings.selectedPlatformId;

      for (const runtimeId of RUNTIME_IDS.filter((id) => supportsMaasRuntimeBinding(id))) {
        const binding = settings.runtimeBindings.find(
          (item) => item.runtimeId === runtimeId && item.platformId === platformId
        );
        const config = (await runtimeOverrideSettings.getItem(runtimeId)) ?? {};
        await this.restoreRuntimeConfig(runtimeId, config, binding, platformId);
      }

      await encryptedAppSecretsStore.deleteSecret(secretKey(platformId));
      await encryptedAppSecretsStore.deleteSecret(inferenceSecretKey(platformId));
      await appSettingsService.update('maas', {
        selectedPlatformId,
        connections,
        runtimeBindings: settings.runtimeBindings.filter(
          (binding) => binding.platformId !== platformId
        ),
      });
      this.recordsCacheByConnection.clear();
      telemetryService.capture('maas_platform_disconnected', { platform: platformId });
      return { success: true };
    } catch (error) {
      log.error('Failed to disconnect MaaS platform:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to disconnect MaaS platform.',
      };
    }
  }

  async listInvocationRecords(args: {
    platformId: MaasPlatformId;
    kind: MaasInvocationFilterKind;
    offset?: number;
    limit?: number;
    forceRefresh?: boolean;
  }): Promise<MaasInvocationPage> {
    const settings = await appSettingsService.get('maas');
    if (!getConnectedPlatform(settings, args.platformId)) {
      return {
        records: [],
        nextOffset: null,
        total: 0,
        source: 'none',
        fetchedAt: null,
        period: null,
      };
    }

    const { offset, limit } = normalizePageArgs(args);
    const result = await this.listRealRecords(settings, args.platformId, !!args.forceRefresh);
    const allRecords = result.records;
    const filteredRecords =
      args.kind === 'all' ? allRecords : allRecords.filter((record) => record.kind === args.kind);
    const records = filteredRecords.slice(offset, offset + limit);
    const nextOffset =
      offset + records.length < filteredRecords.length ? offset + records.length : null;

    return {
      records,
      nextOffset,
      total: filteredRecords.length,
      source: result.source,
      fetchedAt: result.fetchedAt,
      period: result.period,
    };
  }

  async getUsageSummary(input: MaasUsageSummaryInput): Promise<MaasUsageSummary> {
    const kind = input.kind ?? 'all';
    const settings = await appSettingsService.get('maas');
    if (!getConnectedPlatform(settings, input.platformId)) {
      return {
        platformId: input.platformId,
        recordCount: 0,
        totalRecords: 0,
        totalInputTokens: null,
        totalOutputTokens: null,
        totalCostUsd: null,
        source: 'none',
        fetchedAt: null,
        period: null,
      };
    }

    const result = await this.listRealRecords(settings, input.platformId, !!input.forceRefresh);
    const kindFiltered =
      kind === 'all' ? result.records : result.records.filter((record) => record.kind === kind);
    const providerHints = normalizeHints(input.providerHints);
    const modelHints = normalizeHints(input.modelHints);
    const records = kindFiltered.filter((record) =>
      matchesHints(record, providerHints, modelHints)
    );

    return {
      platformId: input.platformId,
      recordCount: records.length,
      totalRecords: kindFiltered.length,
      totalInputTokens: sumNullable(records, (record) => record.inputTokens),
      totalOutputTokens: sumNullable(records, (record) => record.outputTokens),
      totalCostUsd: sumNullable(records, (record) => record.costUsd),
      source: result.source,
      fetchedAt: result.fetchedAt,
      period: result.period,
    };
  }

  async listTextModelCandidates(forceRefresh = false): Promise<string[]> {
    const settings = await appSettingsService.get('maas');
    if (!getConnectedPlatform(settings, 'zenmux')) return [];

    const result = await this.listRealRecords(settings, 'zenmux', forceRefresh);
    const models = new Set<string>();
    for (const record of result.records) {
      const model = record.model?.trim();
      if (record.kind === 'text' && model) models.add(model);
    }
    return [...models];
  }

  async listZenmuxCatalogTextModelCandidates(forceRefresh = false): Promise<string[]> {
    if (forceRefresh) {
      this.zenmuxModelCatalogCache.invalidate();
    }

    return this.zenmuxModelCatalogCache.get(() => this.fetchZenmuxCatalogTextModels());
  }

  private async listRealRecords(
    settings: MaasSettings,
    platformId: MaasPlatformId,
    forceRefresh: boolean
  ): Promise<RealRecordsResult> {
    const connection = getConnectedPlatform(settings, platformId);
    if (!connection) {
      return {
        records: [],
        source: 'none',
        fetchedAt: null,
        period: null,
      };
    }

    if (platformId !== 'zenmux') {
      throw new Error(
        `${MAAS_PLATFORMS[platformId].name} real usage history is not available yet. ZenMux usage data is loaded from its Management API.`
      );
    }

    const cacheKey = `${platformId}:${connection.endpoint}:${connection.keyFingerprint ?? ''}`;
    let cache = this.recordsCacheByConnection.get(cacheKey);
    if (!cache) {
      cache = new TTLCache<RealRecordsResult>(REAL_RECORDS_CACHE_TTL_MS);
      this.recordsCacheByConnection.set(cacheKey, cache);
    }
    if (forceRefresh) {
      cache.invalidate();
    }

    return cache.get(() => this.fetchZenmuxUsageRecords(connection));
  }

  private async loadPlatformInfoSnapshot(
    platformId: MaasPlatformId,
    forceRefresh: boolean
  ): Promise<MaasPlatformInfoSnapshot> {
    const platform = MAAS_PLATFORMS[platformId];
    const stored = await getMaasPlatformInfoSnapshot(platformId);
    if (!forceRefresh && stored && isFreshPlatformInfoSnapshot(stored, platform)) {
      return stored;
    }

    const result = await this.fetchPlatformInfoSnapshot(platform);
    if (result.persist) {
      await setMaasPlatformInfoSnapshot(platformId, result.snapshot);
      return result.snapshot;
    }

    return stored ?? result.snapshot;
  }

  private async fetchPlatformInfoSnapshot(
    platform: (typeof MAAS_PLATFORMS)[MaasPlatformId]
  ): Promise<{ snapshot: MaasPlatformInfoSnapshot; persist: boolean }> {
    const sourceUrl = platform.officialDescriptionUrl || platform.docsUrl;
    try {
      const response = await net.fetch(sourceUrl, {
        headers: {
          Accept: 'text/html,application/xhtml+xml',
        },
        signal: AbortSignal.timeout(PLATFORM_DESCRIPTION_TIMEOUT_MS),
      });

      if (!response.ok) {
        throw new Error(
          `Official page returned ${response.status} ${response.statusText || ''}`.trim()
        );
      }

      const html = await response.text();
      return {
        snapshot: extractMaasPlatformInfoSnapshot({
          platform,
          sourceUrl,
          html,
        }),
        persist: true,
      };
    } catch (error) {
      const message =
        error instanceof Error && error.name === 'TimeoutError'
          ? `Request timed out after ${PLATFORM_DESCRIPTION_TIMEOUT_MS / 1000}s.`
          : error instanceof Error
            ? error.message
            : 'Official page request failed.';
      log.warn(`Failed to fetch MaaS platform description for ${platform.id}:`, error);
      return {
        snapshot: fallbackMaasPlatformInfoSnapshot(platform, sourceUrl, message),
        persist: false,
      };
    }
  }

  private async fetchZenmuxUsageRecords(
    connection: MaasPlatformConnection
  ): Promise<RealRecordsResult> {
    const apiKey = await encryptedAppSecretsStore.getSecret(secretKey('zenmux'));
    if (!apiKey) {
      throw new Error(
        'ZenMux Management API key is missing. Reconnect ZenMux with a management key.'
      );
    }

    const [tokens, costs] = await Promise.all([
      this.fetchZenmuxTimeseries(connection.endpoint, apiKey, 'tokens'),
      this.fetchZenmuxTimeseries(connection.endpoint, apiKey, 'cost'),
    ]);

    const fallbackPeriod = zenmuxUsageDateRange();

    return {
      records: buildZenmuxUsageRecords(tokens.data, costs.data),
      source: 'zenmux-management-statistics',
      fetchedAt: new Date().toISOString(),
      period: {
        startingAt: tokens.data?.starting_at ?? fallbackPeriod.startingAt,
        endingAt: tokens.data?.ending_at ?? fallbackPeriod.endingAt,
      },
    };
  }

  private async fetchZenmuxTimeseries(
    endpoint: string,
    apiKey: string,
    metric: ZenmuxStatisticsMetric
  ): Promise<ZenmuxTimeseriesResponse> {
    const { startingAt, endingAt } = zenmuxUsageDateRange();
    const url = zenmuxManagementUrl(endpoint, 'statistics/timeseries');
    url.searchParams.set('metric', metric);
    url.searchParams.set('bucket_width', '1d');
    url.searchParams.set('starting_at', startingAt);
    url.searchParams.set('ending_at', endingAt);
    url.searchParams.set('limit', String(ZENMUX_MAX_MODELS_PER_BUCKET));

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    });

    let body: ZenmuxTimeseriesResponse | null = null;
    try {
      body = (await response.json()) as ZenmuxTimeseriesResponse;
    } catch {
      body = null;
    }

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new Error(
          'ZenMux statistics requires a Management API Key created in ZenMux Console > Management. Ordinary inference API keys are not supported.'
        );
      }

      throw new Error(
        `ZenMux usage API returned ${response.status}: ${getErrorMessage(
          body,
          response.statusText || 'Request failed.'
        )}`
      );
    }

    if (body?.success === false) {
      throw new Error(getErrorMessage(body, 'ZenMux usage API rejected the request.'));
    }

    if (!Array.isArray(body?.data?.series)) {
      throw new Error('ZenMux usage API did not return a timeseries payload.');
    }

    return body;
  }

  private async fetchZenmuxCatalogTextModels(): Promise<string[]> {
    const base = `${MAAS_PLATFORMS.zenmux.defaultEndpoint.replace(/\/+$/, '')}/`;
    const url = new URL('models', base);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ZENMUX_MODEL_CATALOG_TIMEOUT_MS);

    try {
      const response = await fetch(url, { signal: controller.signal });
      let body: ZenmuxModelsResponse | null = null;
      try {
        body = (await response.json()) as ZenmuxModelsResponse;
      } catch {
        body = null;
      }

      if (!response.ok) {
        throw new Error(
          `ZenMux model catalog returned ${response.status}: ${getErrorMessage(
            body,
            response.statusText || 'Request failed.'
          )}`
        );
      }

      if (!Array.isArray(body?.data)) {
        throw new Error('ZenMux model catalog did not return a model list.');
      }

      const models = new Set<string>();
      for (const model of body.data) {
        const id = model.id?.trim();
        if (!id) continue;
        if (model.object && model.object !== 'model') continue;
        if (!isTextCatalogModel(model)) continue;
        models.add(id);
      }

      return [...models];
    } finally {
      clearTimeout(timer);
    }
  }
}

export const maasService = new MaasService();

function isTextCatalogModel(model: ZenmuxCatalogModel): boolean {
  const outputModalities = model.output_modalities ?? [];
  if (outputModalities.length > 0 && !outputModalities.includes('text')) return false;

  const inputModalities = model.input_modalities ?? [];
  if (inputModalities.length > 0 && !inputModalities.includes('text')) return false;

  return inferInvocationKind(model.id ?? '') === 'text';
}
