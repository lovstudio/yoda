import { clipboard, net } from 'electron';
import type { MaasSettings, RuntimeCustomConfig } from '@shared/app-settings';
import {
  createMaasProfileId,
  getLegacyMaasPlatformId,
  getMaasPlatformDefinition,
  getMaasPlatformTemplateId,
  isCustomMaasPlatformId,
  isMaasPlatformId,
  isValidMaasEnvKey,
  MAAS_PLATFORM_IDS,
  MAAS_PLATFORMS,
  resolveMaasEnvKey,
  supportsMaasPlatformForRuntime,
  type MaasApiKeyKind,
  type MaasCodexClientSyncStatus,
  type MaasConnectInput,
  type MaasConnection,
  type MaasConnectionCheckResult,
  type MaasCopyStoredApiKeyInput,
  type MaasDuplicateProfileInput,
  type MaasGlobalBindingStatus,
  type MaasInvocationFilterKind,
  type MaasInvocationKind,
  type MaasInvocationPage,
  type MaasInvocationRecord,
  type MaasPlatformConnection,
  type MaasPlatformDefinition,
  type MaasPlatformId,
  type MaasPlatformInfoSnapshot,
  type MaasPlatformOfficialDescription,
  type MaasPlatformTemplateId,
  type MaasProfileWebsiteInspection,
  type MaasRuntimeBinding,
  type MaasRuntimeBindingStatus,
  type MaasSetCodexClientSyncInput,
  type MaasSetGlobalBindingInput,
  type MaasSetRuntimeBindingInput,
  type MaasUsageSummary,
  type MaasUsageSummaryInput,
} from '@shared/maas';
import { isValidRuntimeId, RUNTIME_IDS, type RuntimeId } from '@shared/runtime-registry';
import { resolveRuntimeStateDirectory } from '@main/core/conversations/impl/runtime-env';
import { invalidateRuntimeSessions } from '@main/core/conversations/invalidate-runtime-sessions';
import { TTLCache } from '@main/core/utils/ttl-cache';
import { log } from '@main/lib/logger';
import { telemetryService } from '@main/lib/telemetry';
import { encryptedAppSecretsStore } from '../secrets/encrypted-app-secrets-store';
import { runtimeOverrideSettings } from '../settings/runtime-settings-service';
import { appSettingsService } from '../settings/settings-service';
import { migrateLegacyCodexMaasHistoryForConfig } from './codex-history-compat';
import { codexMaasAuthSwitch, type CodexMaasAuthRollback } from './codex-maas-auth-switch';
import {
  buildOpenRouterUsageSummary,
  openRouterUsageUrl,
  type OpenRouterCreditsResponse,
  type OpenRouterKeyResponse,
} from './openrouter-usage';
import {
  extractMaasPlatformInfoSnapshot,
  fallbackMaasPlatformInfoSnapshot,
  MAAS_PLATFORM_INFO_SNAPSHOT_VERSION,
  toMaasPlatformOfficialDescription,
} from './platform-description';
import { getMaasPlatformInfoSnapshot, setMaasPlatformInfoSnapshot } from './platform-info-store';
import { extractMaasProfileWebsiteMetadata } from './profile-website-metadata';
import { resolveRestoredMaasRuntimeConfig, supportsMaasRuntimeBinding } from './runtime-env';

const SECRET_PREFIX = 'yoda-maas-token';
const INFERENCE_SECRET_PREFIX = 'yoda-maas-inference-token';
const REAL_RECORDS_CACHE_TTL_MS = 30_000;
const PLATFORM_INFO_CACHE_TTL_MS = 24 * 60 * 60 * 1_000;
const PLATFORM_DESCRIPTION_TIMEOUT_MS = 10_000;
const PROFILE_WEBSITE_TIMEOUT_MS = 10_000;
const PROFILE_WEBSITE_MAX_BYTES = 2 * 1024 * 1024;
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

type MaasInferenceCredentials = {
  displayName: string;
  endpoint: string;
  apiKey: string;
  envKey?: string;
  syncToAgentClient?: boolean;
  loginItemEnabled?: boolean;
};

function secretKey(platformId: MaasPlatformId): string {
  return `${SECRET_PREFIX}:${platformId}`;
}

function inferenceSecretKey(platformId: MaasPlatformId): string {
  return `${INFERENCE_SECRET_PREFIX}:${platformId}`;
}

async function readPlatformSecret(
  platformId: MaasPlatformId,
  kind: MaasApiKeyKind
): Promise<string | null> {
  const keyFor = kind === 'inference' ? inferenceSecretKey : secretKey;
  const current = await encryptedAppSecretsStore.getSecret(keyFor(platformId));
  if (current) return current;
  const legacyId = getLegacyMaasPlatformId(platformId);
  return legacyId ? encryptedAppSecretsStore.getSecret(keyFor(legacyId)) : null;
}

async function deletePlatformSecrets(platformId: MaasPlatformId): Promise<void> {
  const ids = [platformId, getLegacyMaasPlatformId(platformId)].filter(
    (value): value is MaasPlatformId => value !== null
  );
  await Promise.all(
    ids.flatMap((id) => [
      encryptedAppSecretsStore.deleteSecret(secretKey(id)),
      encryptedAppSecretsStore.deleteSecret(inferenceSecretKey(id)),
    ])
  );
}

function keyFingerprint(apiKey: string): string {
  const trimmed = apiKey.trim();
  if (trimmed.length <= 4) return trimmed;
  return `${trimmed.slice(0, 2)}...${trimmed.slice(-2)}`;
}

function normalizeProfileWebsiteUrl(value: string): URL | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(/^[a-z][a-z\d+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url : null;
  } catch {
    return null;
  }
}

async function readBoundedHtml(response: Response): Promise<string> {
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > PROFILE_WEBSITE_MAX_BYTES) {
    throw new Error('The homepage is too large to inspect.');
  }
  if (!response.body) return '';

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let byteCount = 0;
  let html = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      byteCount += value.byteLength;
      if (byteCount > PROFILE_WEBSITE_MAX_BYTES) {
        throw new Error('The homepage is too large to inspect.');
      }
      html += decoder.decode(value, { stream: true });
    }
    return html + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

function migrateLegacyCodexHistory(
  providerConfig: RuntimeCustomConfig | undefined,
  includeNativeProvider = false
): void {
  const migration = migrateLegacyCodexMaasHistoryForConfig(providerConfig, {
    includeNativeProvider,
  });
  if (migration.failed) {
    log.warn('Could not migrate legacy Codex MaaS thread metadata; will retry later', {
      rows: migration.rows,
      files: migration.files,
    });
  }
}

function createRuntimeBinding({
  runtimeId,
  platformId,
  currentConfig,
  existingBinding,
  enabledAt,
}: {
  runtimeId: RuntimeId;
  platformId: MaasPlatformId;
  currentConfig: RuntimeCustomConfig;
  existingBinding: MaasRuntimeBinding | undefined;
  enabledAt: string;
}): MaasRuntimeBinding {
  const previousConfig =
    existingBinding?.previousConfig !== undefined
      ? structuredClone(existingBinding.previousConfig)
      : existingBinding || currentConfig.authProvider === 'yoda-maas'
        ? resolveRestoredMaasRuntimeConfig(currentConfig, existingBinding)
        : structuredClone(currentConfig);

  return {
    runtimeId,
    platformId,
    previousAuthProvider: previousConfig.authProvider ?? null,
    previousMaasPlatformId: previousConfig.maasPlatformId ?? null,
    previousConfig,
    enabledAt: existingBinding?.enabledAt ?? enabledAt,
  };
}

function defaultConnection(platformId: MaasPlatformId): MaasConnection {
  const platform = getMaasPlatformDefinition(platformId);
  return {
    platformId,
    displayName: platform.name,
    endpoint: platform.defaultEndpoint,
    keyFingerprint: null,
    inferenceKeyFingerprint: null,
    connectedAt: null,
    lastCheckedAt: null,
    lastTest: null,
    configured: false,
    connected: false,
    error: null,
  };
}

function toConnection(
  saved: MaasPlatformConnection | undefined,
  platformId: MaasPlatformId
): MaasConnection {
  if (!saved) return defaultConnection(platformId);
  const platform = getMaasPlatformDefinition(platformId);
  return {
    ...saved,
    displayName:
      isCustomMaasPlatformId(platformId) && saved.displayName === 'Custom OpenAI'
        ? platform.name
        : saved.displayName,
    configured: true,
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

function getConnectedPlatformByTemplate(
  settings: MaasSettings,
  templateId: MaasPlatformTemplateId
): MaasPlatformConnection | undefined {
  return settings.connections.find(
    (connection) => getMaasPlatformTemplateId(connection.platformId) === templateId
  );
}

function hasExternalAgentSyncConsent(settings: MaasSettings): boolean {
  if (settings.externalAgentSyncEnabled !== undefined) {
    return settings.externalAgentSyncEnabled === true && settings.externalAgentSyncVersion === 1;
  }
  return settings.connections.some(
    (connection) =>
      connection.syncToAgentClient === true && connection.syncToAgentClientVersion === 1
  );
}

function withoutLegacyClientSync(
  connections: MaasSettings['connections']
): MaasSettings['connections'] {
  return connections.map(
    ({ syncToAgentClient: _enabled, syncToAgentClientVersion: _version, ...connection }) =>
      connection
  );
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
  platform: MaasPlatformDefinition
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
    MaasPlatformTemplateId,
    TTLCache<MaasPlatformInfoSnapshot>
  >();
  private readonly zenmuxModelCatalogCache = new TTLCache<string[]>(
    ZENMUX_MODEL_CATALOG_CACHE_TTL_MS
  );

  /**
   * Reconcile one Codex account/profile root with Yoda's current MaaS route.
   *
   * Session discovery can surface threads from several CODEX_HOME roots. Each
   * root keeps its own Codex config, while the Yoda MaaS selection is global.
   * Apply (or restore) the binding lazily before resuming a thread from that
   * root so historical visibility never depends on which account root is
   * currently active.
   */
  async reconcileCodexStateRoot(codexHome: string): Promise<void> {
    const settings = await appSettingsService.get('maas');
    const binding = settings.runtimeBindings.find((item) => item.runtimeId === 'codex');
    if (!binding) {
      if (hasExternalAgentSyncConsent(settings)) {
        await codexMaasAuthSwitch.enableOfficial({ codexHome });
      } else {
        await codexMaasAuthSwitch.disable({ codexHome });
      }
      return;
    }
    if (!supportsMaasPlatformForRuntime('codex', binding.platformId)) {
      throw new Error('The active MaaS platform is not compatible with Codex.');
    }
    const credentials = await this.getInferenceCredentials(binding.platformId);
    if (!credentials) {
      throw new Error(
        'The active Codex MaaS binding is missing its inference credential; reconnect the platform.'
      );
    }
    await this.applyCodexClientSync(codexHome, binding.platformId, credentials);
  }

  /**
   * Re-apply native Codex files for a persisted MaaS binding.
   *
   * This is intentionally run at startup: earlier Yoda versions routed ZenMux
   * through the built-in OpenAI provider, and an already-enabled binding would
   * otherwise never pass through enable() again to receive the corrected
   * provider-specific configuration.
   */
  async reconcileActiveBindings(): Promise<void> {
    const settings = await appSettingsService.get('maas');
    const binding = settings.runtimeBindings.find((item) => item.runtimeId === 'codex');
    const currentConfig = (await runtimeOverrideSettings.getItem('codex')) ?? {};
    migrateLegacyCodexHistory(currentConfig, hasExternalAgentSyncConsent(settings));
    if (!binding) {
      if (hasExternalAgentSyncConsent(settings)) {
        await codexMaasAuthSwitch.enableOfficial({
          codexHome: resolveRuntimeStateDirectory('codex', currentConfig),
        });
      }
      return;
    }
    if (!supportsMaasPlatformForRuntime('codex', binding.platformId)) {
      throw new Error('The active MaaS platform is not compatible with Codex.');
    }

    const inferenceCredentials = await this.getInferenceCredentials(binding.platformId);
    if (!inferenceCredentials) {
      throw new Error(
        'The active Codex MaaS binding is missing its inference credential; reconnect the platform.'
      );
    }

    let rollbackCodexAuth: CodexMaasAuthRollback | undefined;

    try {
      rollbackCodexAuth = await this.applyCodexClientSync(
        resolveRuntimeStateDirectory('codex', currentConfig),
        binding.platformId,
        inferenceCredentials
      );
      if (
        currentConfig.authProvider !== 'yoda-maas' ||
        currentConfig.maasPlatformId !== binding.platformId
      ) {
        await runtimeOverrideSettings.updateItem('codex', {
          ...currentConfig,
          authProvider: 'yoda-maas',
          maasPlatformId: binding.platformId,
        });
      }
    } catch (error) {
      await rollbackCodexAuth?.();
      throw error;
    }
  }

  async getCodexClientSyncStatus(): Promise<MaasCodexClientSyncStatus> {
    const settings = await appSettingsService.get('maas');
    const binding = settings.runtimeBindings.find((item) => item.runtimeId === 'codex');
    const connection = binding ? getConnectedPlatform(settings, binding.platformId) : undefined;
    const currentConfig = (await runtimeOverrideSettings.getItem('codex')) ?? {};
    const nativeStatus = await codexMaasAuthSwitch.getStatus({
      codexHome: resolveRuntimeStateDirectory('codex', currentConfig),
    });
    const enabled = hasExternalAgentSyncConsent(settings);

    return {
      supported: process.platform === 'darwin',
      enabled,
      managed: nativeStatus.managed,
      configManaged: nativeStatus.configManaged,
      environmentPublished: nativeStatus.environmentPublished,
      persistentCredentialStored: nativeStatus.persistentCredentialStored,
      loginItemEnabled: settings.externalAgentSyncLoginItemEnabled ?? true,
      platformId: connection?.platformId ?? null,
      displayName: connection?.displayName ?? null,
      envKey:
        nativeStatus.envKey ??
        (connection
          ? resolveMaasEnvKey(connection.platformId, connection.displayName, connection.envKey)
          : null),
      persistsAfterQuit: settings.externalAgentSyncLoginItemEnabled ?? true,
    };
  }

  async setCodexClientSync(input: MaasSetCodexClientSyncInput): Promise<{
    success: boolean;
    status?: MaasCodexClientSyncStatus;
    error?: string;
  }> {
    // Codex is the first external Agent Client adapter. Keep consent global so
    // future adapters can join this switch without moving it back into a Profile.
    if (process.platform !== 'darwin') {
      return { success: false, error: 'Persistent Codex Client sync currently requires macOS.' };
    }
    if (typeof input.enabled !== 'boolean') {
      return { success: false, error: 'Invalid Codex Client sync state.' };
    }
    if (input.loginItemEnabled !== undefined && typeof input.loginItemEnabled !== 'boolean') {
      return { success: false, error: 'Invalid Codex login item state.' };
    }

    const settings = await appSettingsService.get('maas');
    const activeCodexBinding = settings.runtimeBindings.find(
      (binding) => binding.runtimeId === 'codex'
    );
    const connection = activeCodexBinding
      ? getConnectedPlatform(settings, activeCodexBinding.platformId)
      : undefined;
    let rollbackCodexAuth: CodexMaasAuthRollback | undefined;

    try {
      const currentConfig = (await runtimeOverrideSettings.getItem('codex')) ?? {};
      if (!input.enabled) {
        rollbackCodexAuth = await codexMaasAuthSwitch.disable({
          codexHome: resolveRuntimeStateDirectory('codex', currentConfig),
        });
      } else if (activeCodexBinding) {
        if (!connection) {
          return { success: false, error: 'The active MaaS Profile is no longer available.' };
        }
        const apiKey = await readPlatformSecret(
          activeCodexBinding.platformId,
          getMaasPlatformTemplateId(activeCodexBinding.platformId) === 'zenmux'
            ? 'inference'
            : 'primary'
        );
        if (!apiKey) {
          return {
            success: false,
            error: 'The Agent Client API key is missing. Reconnect this Profile first.',
          };
        }
        rollbackCodexAuth = await codexMaasAuthSwitch.enable({
          codexHome: resolveRuntimeStateDirectory('codex', currentConfig),
          platformId: activeCodexBinding.platformId,
          displayName: connection.displayName,
          endpoint: connection.endpoint,
          envKey: resolveMaasEnvKey(
            activeCodexBinding.platformId,
            connection.displayName,
            connection.envKey
          ),
          apiKey,
          loginItemEnabled:
            input.loginItemEnabled ?? settings.externalAgentSyncLoginItemEnabled ?? true,
        });
      } else {
        rollbackCodexAuth = await codexMaasAuthSwitch.enableOfficial({
          codexHome: resolveRuntimeStateDirectory('codex', currentConfig),
        });
      }
      if (input.enabled) migrateLegacyCodexHistory(currentConfig, true);

      await appSettingsService.update('maas', {
        externalAgentSyncEnabled: input.enabled,
        externalAgentSyncVersion: input.enabled ? 1 : undefined,
        externalAgentSyncLoginItemEnabled:
          input.loginItemEnabled ?? settings.externalAgentSyncLoginItemEnabled ?? true,
        connections: withoutLegacyClientSync(settings.connections),
      });
      const status = await this.getCodexClientSyncStatus().catch((statusError) => {
        log.warn('Codex Client sync changed, but its status could not be refreshed:', statusError);
        return undefined;
      });
      return { success: true, status };
    } catch (error) {
      await rollbackCodexAuth?.().catch((rollbackError) => {
        log.error('Failed to roll back Codex Client sync update:', rollbackError);
      });
      log.error('Failed to update Codex Client sync:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to update Codex Client sync.',
      };
    }
  }

  async clearCodexClientSync(): Promise<{
    success: boolean;
    status?: MaasCodexClientSyncStatus;
    error?: string;
  }> {
    const settings = await appSettingsService.get('maas');
    const currentConfig = (await runtimeOverrideSettings.getItem('codex')) ?? {};
    let rollback: CodexMaasAuthRollback | undefined;

    try {
      rollback = await codexMaasAuthSwitch.disable({
        codexHome: resolveRuntimeStateDirectory('codex', currentConfig),
      });
      await appSettingsService.update('maas', {
        externalAgentSyncEnabled: false,
        externalAgentSyncVersion: undefined,
        connections: withoutLegacyClientSync(settings.connections),
      });
      return { success: true, status: await this.getCodexClientSyncStatus() };
    } catch (error) {
      await rollback?.().catch((rollbackError) => {
        log.error('Failed to roll back Codex Client sync cleanup:', rollbackError);
      });
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to clear Codex Client sync.',
      };
    }
  }

  async listConnections(): Promise<MaasConnection[]> {
    const settings = await appSettingsService.get('maas');
    return Promise.all(
      settings.connections.map(async (saved) => {
        const platformId = saved.platformId;
        const templateId = getMaasPlatformTemplateId(platformId);
        const apiKey = await readPlatformSecret(platformId, 'primary');
        const inferenceApiKey = await readPlatformSecret(
          platformId,
          templateId === 'zenmux' ? 'inference' : 'primary'
        );
        const connection = {
          ...saved,
          displayName:
            isCustomMaasPlatformId(platformId) && saved.displayName === 'Custom OpenAI'
              ? getMaasPlatformDefinition(platformId).name
              : saved.displayName,
          envKey: resolveMaasEnvKey(platformId, saved.displayName, saved.envKey),
          syncToAgentClient: undefined,
          syncToAgentClientVersion: undefined,
          keyFingerprint: apiKey ? keyFingerprint(apiKey) : saved.keyFingerprint,
          inferenceKeyFingerprint: inferenceApiKey
            ? keyFingerprint(inferenceApiKey)
            : saved.inferenceKeyFingerprint,
        };
        const hasCredential = Boolean(apiKey || inferenceApiKey);
        return {
          ...connection,
          configured: true,
          connected: hasCredential,
          error: hasCredential
            ? null
            : 'Credentials are not synced. Reconnect this MaaS platform on this device.',
        };
      })
    );
  }

  async inspectProfileWebsite(websiteUrl: string): Promise<MaasProfileWebsiteInspection> {
    const url = normalizeProfileWebsiteUrl(websiteUrl);
    if (!url) return { success: false, error: 'Enter a valid HTTP or HTTPS website URL.' };

    try {
      const response = await net.fetch(url.toString(), {
        headers: { Accept: 'text/html,application/xhtml+xml' },
        credentials: 'omit',
        signal: AbortSignal.timeout(PROFILE_WEBSITE_TIMEOUT_MS),
      });
      if (!response.ok) {
        throw new Error(`Homepage returned ${response.status} ${response.statusText}`.trim());
      }
      const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
      if (contentType && !contentType.includes('text/html')) {
        throw new Error('The URL did not return an HTML homepage.');
      }
      const finalUrl = response.url || url.toString();
      const metadata = extractMaasProfileWebsiteMetadata(await readBoundedHtml(response), finalUrl);
      if (!metadata.name && !metadata.description && !metadata.logoUrl) {
        return { success: false, error: 'No usable product information was found.' };
      }
      return { success: true, metadata };
    } catch (error) {
      const message =
        error instanceof Error && error.name === 'TimeoutError'
          ? `Request timed out after ${PROFILE_WEBSITE_TIMEOUT_MS / 1_000}s.`
          : error instanceof Error
            ? error.message
            : 'Could not inspect the homepage.';
      log.warn(`Failed to inspect MaaS profile website ${url.origin}:`, error);
      return { success: false, error: message };
    }
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

  async getGlobalBinding(): Promise<MaasGlobalBindingStatus> {
    const settings = await appSettingsService.get('maas');
    const platformIds = new Set(settings.runtimeBindings.map((binding) => binding.platformId));
    const platformId =
      settings.runtimeBindings.length === 0
        ? null
        : platformIds.size === 1
          ? ([...platformIds][0] ?? null)
          : settings.selectedPlatformId;
    const runtimeIds = platformId
      ? RUNTIME_IDS.filter(
          (runtimeId) =>
            supportsMaasRuntimeBinding(runtimeId) &&
            supportsMaasPlatformForRuntime(runtimeId, platformId)
        )
      : [];
    const statuses = await this.listRuntimeBindings();
    const enabled = settings.runtimeBindings.length > 0;
    const effective =
      enabled &&
      runtimeIds.every((runtimeId) =>
        statuses.some(
          (status) =>
            status.runtimeId === runtimeId && status.platformId === platformId && status.effective
        )
      );

    return { platformId, enabled, effective, runtimeIds };
  }

  async setGlobalBinding(
    input: MaasSetGlobalBindingInput
  ): Promise<{ success: boolean; error?: string }> {
    if (!isMaasPlatformId(input.platformId)) {
      return { success: false, error: 'Unsupported MaaS platform.' };
    }
    const inferenceCredentials = input.enabled
      ? await this.getInferenceCredentials(input.platformId)
      : undefined;
    if (input.enabled && !inferenceCredentials) {
      return {
        success: false,
        error: 'Connect the MaaS platform and save an API key before enabling it.',
      };
    }

    const settings = await appSettingsService.get('maas');
    const originalRuntimeOverrides = await runtimeOverrideSettings.getOverrides();
    migrateLegacyCodexHistory(
      originalRuntimeOverrides.codex,
      hasExternalAgentSyncConsent(settings)
    );
    const supportedRuntimeIds = RUNTIME_IDS.filter((runtimeId) =>
      supportsMaasRuntimeBinding(runtimeId)
    );
    let rollbackCodexAuth: CodexMaasAuthRollback | undefined;

    try {
      if (!input.enabled) {
        for (const runtimeId of supportedRuntimeIds) {
          const currentConfig = (await runtimeOverrideSettings.getItem(runtimeId)) ?? {};
          const binding = settings.runtimeBindings.find((item) => item.runtimeId === runtimeId);
          if (runtimeId === 'codex') {
            const codexHome = resolveRuntimeStateDirectory('codex', currentConfig);
            rollbackCodexAuth = hasExternalAgentSyncConsent(settings)
              ? await codexMaasAuthSwitch.enableOfficial({ codexHome })
              : await codexMaasAuthSwitch.disable({ codexHome });
          }
          if (binding || currentConfig.authProvider === 'yoda-maas') {
            await runtimeOverrideSettings.updateItem(
              runtimeId,
              resolveRestoredMaasRuntimeConfig(currentConfig, binding)
            );
          }
        }
        await appSettingsService.update('maas', { runtimeBindings: [] });
        await invalidateRuntimeSessions({
          runtimeIds: supportedRuntimeIds,
          reason: 'MaaS global routing disabled',
        });
        return { success: true };
      }

      const enabledAt = new Date().toISOString();
      const nextBindings: MaasRuntimeBinding[] = [];
      for (const runtimeId of supportedRuntimeIds) {
        const currentConfig = (await runtimeOverrideSettings.getItem(runtimeId)) ?? {};
        const existingBinding = settings.runtimeBindings.find(
          (item) => item.runtimeId === runtimeId
        );

        if (!supportsMaasPlatformForRuntime(runtimeId, input.platformId)) {
          if (existingBinding || currentConfig.authProvider === 'yoda-maas') {
            if (runtimeId === 'codex') {
              rollbackCodexAuth = await codexMaasAuthSwitch.disable({
                codexHome: resolveRuntimeStateDirectory('codex', currentConfig),
              });
            }
            await runtimeOverrideSettings.updateItem(
              runtimeId,
              resolveRestoredMaasRuntimeConfig(currentConfig, existingBinding)
            );
          }
          continue;
        }

        const binding = createRuntimeBinding({
          runtimeId,
          platformId: input.platformId,
          currentConfig,
          existingBinding,
          enabledAt,
        });
        nextBindings.push(binding);
        if (runtimeId === 'codex' && inferenceCredentials) {
          rollbackCodexAuth = await this.applyCodexClientSync(
            resolveRuntimeStateDirectory('codex', currentConfig),
            input.platformId,
            inferenceCredentials
          );
        }
        await runtimeOverrideSettings.updateItem(runtimeId, {
          ...currentConfig,
          authProvider: 'yoda-maas',
          maasPlatformId: input.platformId,
        });
      }

      await appSettingsService.update('maas', {
        selectedPlatformId: input.platformId,
        runtimeBindings: nextBindings,
      });
      await invalidateRuntimeSessions({
        runtimeIds: supportedRuntimeIds,
        reason: 'MaaS global routing changed',
      });
      return { success: true };
    } catch (error) {
      try {
        await runtimeOverrideSettings.replaceOverrides(originalRuntimeOverrides);
      } catch (rollbackError) {
        log.error('Failed to roll back global MaaS runtime settings:', rollbackError);
      }
      try {
        await appSettingsService.update('maas', settings);
      } catch (rollbackError) {
        log.error('Failed to roll back global MaaS app settings:', rollbackError);
      }
      try {
        await rollbackCodexAuth?.();
      } catch (rollbackError) {
        log.error('Failed to roll back global MaaS Codex authentication:', rollbackError);
      }
      log.error('Failed to update global MaaS binding:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to update global MaaS binding.',
      };
    }
  }

  async setRuntimeBinding(
    input: MaasSetRuntimeBindingInput
  ): Promise<{ success: boolean; error?: string }> {
    let settingsToRestore: MaasSettings | undefined;
    let runtimeOverridesToRestore:
      | Awaited<ReturnType<typeof runtimeOverrideSettings.getOverrides>>
      | undefined;
    let rollbackCodexAuth: CodexMaasAuthRollback | undefined;
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
      settingsToRestore = settings;
      runtimeOverridesToRestore = await runtimeOverrideSettings.getOverrides();
      const existingBinding = settings.runtimeBindings.find(
        (binding) => binding.runtimeId === input.runtimeId
      );
      const currentConfig = (await runtimeOverrideSettings.getItem(input.runtimeId)) ?? {};
      if (input.runtimeId === 'codex') {
        migrateLegacyCodexHistory(currentConfig, hasExternalAgentSyncConsent(settings));
      }

      if (input.enabled) {
        const activePlatformId = settings.runtimeBindings[0]?.platformId;
        if (activePlatformId && activePlatformId !== input.platformId) {
          return {
            success: false,
            error: 'Only one MaaS platform can be active at a time.',
          };
        }
        const inferenceCredentials = await this.getInferenceCredentials(input.platformId);
        if (!inferenceCredentials) {
          return {
            success: false,
            error: 'Connect the MaaS platform and save an API key before enabling a Client.',
          };
        }

        const binding = createRuntimeBinding({
          runtimeId: input.runtimeId,
          platformId: input.platformId,
          currentConfig,
          existingBinding,
          enabledAt: new Date().toISOString(),
        });
        if (input.runtimeId === 'codex') {
          rollbackCodexAuth = await this.applyCodexClientSync(
            resolveRuntimeStateDirectory('codex', currentConfig),
            input.platformId,
            inferenceCredentials
          );
        }
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
        await invalidateRuntimeSessions({
          runtimeIds: [input.runtimeId],
          reason: 'MaaS runtime routing enabled',
        });
        return { success: true };
      }

      if (existingBinding && existingBinding.platformId !== input.platformId) {
        return { success: true };
      }

      if (input.runtimeId === 'codex') {
        const codexHome = resolveRuntimeStateDirectory('codex', currentConfig);
        rollbackCodexAuth = hasExternalAgentSyncConsent(settings)
          ? await codexMaasAuthSwitch.enableOfficial({ codexHome })
          : await codexMaasAuthSwitch.disable({ codexHome });
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
      await invalidateRuntimeSessions({
        runtimeIds: [input.runtimeId],
        reason: 'MaaS runtime routing disabled',
      });
      return { success: true };
    } catch (error) {
      if (runtimeOverridesToRestore) {
        try {
          await runtimeOverrideSettings.replaceOverrides(runtimeOverridesToRestore);
        } catch (rollbackError) {
          log.error('Failed to roll back MaaS runtime settings:', rollbackError);
        }
      }
      if (settingsToRestore) {
        try {
          await appSettingsService.update('maas', settingsToRestore);
        } catch (rollbackError) {
          log.error('Failed to roll back MaaS app settings:', rollbackError);
        }
      }
      try {
        await rollbackCodexAuth?.();
      } catch (rollbackError) {
        log.error('Failed to roll back MaaS Codex authentication:', rollbackError);
      }
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
  ): Promise<
    | { platformId: MaasPlatformId; displayName: string; endpoint: string; apiKey: string }
    | undefined
  > {
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
    const templateId = getMaasPlatformTemplateId(platformId);

    let cache = this.platformInfoCacheById.get(templateId);
    if (!cache) {
      cache = new TTLCache<MaasPlatformInfoSnapshot>(PLATFORM_INFO_CACHE_TTL_MS);
      this.platformInfoCacheById.set(templateId, cache);
    }
    if (forceRefresh) {
      cache.invalidate();
    }

    return cache.get(() => this.loadPlatformInfoSnapshot(templateId, forceRefresh));
  }

  /**
   * Endpoint + stored API key for a connected platform, for features that call
   * the platform's inference APIs directly (e.g. AI Lab image generation).
   */
  async getInferenceCredentials(
    platformId: MaasPlatformId
  ): Promise<MaasInferenceCredentials | undefined> {
    const settings = await appSettingsService.get('maas');
    const connection = getConnectedPlatform(settings, platformId);
    if (!connection) return undefined;
    const apiKey = await readPlatformSecret(
      platformId,
      getMaasPlatformTemplateId(platformId) === 'zenmux' ? 'inference' : 'primary'
    );
    if (!apiKey) return undefined;
    return {
      displayName: connection.displayName,
      endpoint: connection.endpoint,
      apiKey,
      envKey: resolveMaasEnvKey(platformId, connection.displayName, connection.envKey),
      syncToAgentClient: hasExternalAgentSyncConsent(settings),
      loginItemEnabled: settings.externalAgentSyncLoginItemEnabled ?? true,
    };
  }

  private applyCodexClientSync(
    codexHome: string,
    platformId: MaasPlatformId,
    credentials: MaasInferenceCredentials
  ): Promise<CodexMaasAuthRollback> {
    if (!credentials.syncToAgentClient) {
      return codexMaasAuthSwitch.disable({ codexHome });
    }
    return codexMaasAuthSwitch.enable({
      codexHome,
      platformId,
      displayName: credentials.displayName,
      endpoint: credentials.endpoint,
      envKey: resolveMaasEnvKey(platformId, credentials.displayName, credentials.envKey),
      apiKey: credentials.apiKey,
      loginItemEnabled: credentials.loginItemEnabled ?? true,
    });
  }

  async copyStoredApiKeyToClipboard(
    input: MaasCopyStoredApiKeyInput
  ): Promise<{ success: boolean; error?: string }> {
    try {
      if (!isMaasPlatformId(input.platformId)) {
        return { success: false, error: 'Unsupported MaaS platform.' };
      }
      if (input.kind !== 'primary' && input.kind !== 'inference') {
        return { success: false, error: 'Unsupported MaaS API key kind.' };
      }
      if (input.kind === 'inference' && getMaasPlatformTemplateId(input.platformId) !== 'zenmux') {
        return { success: false, error: 'This platform does not use a separate inference key.' };
      }

      const settings = await appSettingsService.get('maas');
      const connection = getConnectedPlatform(settings, input.platformId);
      if (!connection) {
        return { success: false, error: 'Platform is not connected.' };
      }

      const apiKey = await readPlatformSecret(input.platformId, input.kind);
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
    let settingsToRestore: MaasSettings | undefined;
    const secretsToRestore = new Map<string, string | null>();
    let rollbackCodexAuth: CodexMaasAuthRollback | undefined;
    try {
      if (!isMaasPlatformId(input.platformId)) {
        return { success: false, error: 'Unsupported MaaS platform.' };
      }

      const platform = getMaasPlatformDefinition(input.platformId);
      const templateId = getMaasPlatformTemplateId(input.platformId);
      const settings = await appSettingsService.get('maas');
      settingsToRestore = settings;
      const existing = getConnectedPlatform(settings, input.platformId);
      const apiKey = input.apiKey?.trim() ?? '';
      const inferenceApiKey = input.inferenceApiKey?.trim() ?? '';
      let retainedApiKey: string | null = null;
      if (!apiKey && !existing?.keyFingerprint && !(templateId === 'zenmux' && inferenceApiKey)) {
        return { success: false, error: 'A MaaS API key is required.' };
      }
      if (!apiKey && existing?.keyFingerprint) {
        const existingApiKey = await readPlatformSecret(input.platformId, 'primary');
        if (!existingApiKey) {
          return {
            success: false,
            error: 'Stored MaaS API key is missing. Paste the key again to reconnect.',
          };
        }
        retainedApiKey = existingApiKey;
      }

      const now = new Date().toISOString();
      const displayName = input.displayName?.trim() || platform.name;
      const envKey = resolveMaasEnvKey(input.platformId, displayName, input.envKey);
      if (!isValidMaasEnvKey(envKey)) {
        return { success: false, error: 'Invalid MaaS environment variable name.' };
      }
      const connection: MaasPlatformConnection = {
        platformId: input.platformId,
        displayName,
        endpoint: input.endpoint?.trim() || platform.defaultEndpoint,
        websiteUrl: input.websiteUrl?.trim() || existing?.websiteUrl,
        description: input.description?.trim() || existing?.description,
        logoUrl: input.logoUrl?.trim() || existing?.logoUrl,
        envKey,
        keyFingerprint: apiKey
          ? keyFingerprint(apiKey)
          : retainedApiKey
            ? keyFingerprint(retainedApiKey)
            : (existing?.keyFingerprint ?? null),
        inferenceKeyFingerprint:
          templateId === 'zenmux'
            ? inferenceApiKey
              ? keyFingerprint(inferenceApiKey)
              : (existing?.inferenceKeyFingerprint ?? null)
            : apiKey
              ? keyFingerprint(apiKey)
              : retainedApiKey
                ? keyFingerprint(retainedApiKey)
                : (existing?.inferenceKeyFingerprint ?? existing?.keyFingerprint ?? null),
        connectedAt: existing?.connectedAt ?? now,
        lastCheckedAt: existing?.lastCheckedAt ?? null,
        lastTest: existing?.lastTest ?? null,
      };

      if (apiKey) {
        const key = secretKey(input.platformId);
        secretsToRestore.set(key, await encryptedAppSecretsStore.getSecret(key));
        await encryptedAppSecretsStore.setSecret(key, apiKey);
      }
      if (templateId === 'zenmux' && inferenceApiKey) {
        const key = inferenceSecretKey(input.platformId);
        secretsToRestore.set(key, await encryptedAppSecretsStore.getSecret(key));
        await encryptedAppSecretsStore.setSecret(key, inferenceApiKey);
      }

      await appSettingsService.update('maas', {
        selectedPlatformId: input.platformId,
        connections: upsertConnection(settings.connections, connection),
      });

      const currentCodexConfig = (await runtimeOverrideSettings.getItem('codex')) ?? {};
      const codexHome = resolveRuntimeStateDirectory('codex', currentCodexConfig);

      const activeCodexBinding = settings.runtimeBindings.some(
        (binding) => binding.runtimeId === 'codex' && binding.platformId === input.platformId
      );
      if (activeCodexBinding) {
        const activeApiKey = await readPlatformSecret(
          input.platformId,
          templateId === 'zenmux' ? 'inference' : 'primary'
        );
        if (!activeApiKey) {
          throw new Error(
            'The active Codex MaaS binding is missing its inference credential; reconnect the platform.'
          );
        }
        rollbackCodexAuth = await this.applyCodexClientSync(codexHome, input.platformId, {
          displayName: connection.displayName,
          endpoint: connection.endpoint,
          apiKey: activeApiKey,
          envKey: connection.envKey ?? envKey,
          syncToAgentClient: hasExternalAgentSyncConsent(settings),
        });
      }

      this.recordsCacheByConnection.clear();
      telemetryService.capture('maas_platform_connected', { platform: templateId });

      const affectedRuntimeIds = settings.runtimeBindings
        .filter((binding) => binding.platformId === input.platformId)
        .map((binding) => binding.runtimeId);
      await invalidateRuntimeSessions({
        runtimeIds: affectedRuntimeIds,
        authProviders: ['yoda-maas'],
        reason: 'MaaS credentials changed',
      });

      return { success: true, connection: toConnection(connection, input.platformId) };
    } catch (error) {
      try {
        await rollbackCodexAuth?.();
      } catch (rollbackError) {
        log.error(
          'Failed to roll back Codex authentication after reconnecting MaaS:',
          rollbackError
        );
      }
      if (settingsToRestore) {
        try {
          await appSettingsService.update('maas', settingsToRestore);
        } catch (rollbackError) {
          log.error(
            'Failed to roll back MaaS settings after reconnecting a platform:',
            rollbackError
          );
        }
      }
      for (const [key, value] of secretsToRestore) {
        try {
          if (value === null) {
            await encryptedAppSecretsStore.deleteSecret(key);
          } else {
            await encryptedAppSecretsStore.setSecret(key, value);
          }
        } catch (rollbackError) {
          log.error(
            'Failed to roll back a MaaS secret after reconnecting a platform:',
            rollbackError
          );
        }
      }
      log.error('Failed to connect MaaS platform:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to connect MaaS platform.',
      };
    }
  }

  async duplicateProfile(
    input: MaasDuplicateProfileInput
  ): Promise<{ success: boolean; connection?: MaasConnection; error?: string }> {
    try {
      if (!isMaasPlatformId(input.platformId)) {
        return { success: false, error: 'Unsupported MaaS platform.' };
      }

      const settings = await appSettingsService.get('maas');
      const source = getConnectedPlatform(settings, input.platformId);
      if (!source) {
        return { success: false, error: 'Profile is not connected.' };
      }

      const templateId = getMaasPlatformTemplateId(input.platformId);
      const duplicateId = createMaasProfileId(
        templateId === 'custom'
          ? globalThis.crypto.randomUUID()
          : `${templateId}:${globalThis.crypto.randomUUID()}`
      );
      const apiKey = await readPlatformSecret(input.platformId, 'primary');
      const inferenceApiKey =
        templateId === 'zenmux'
          ? await readPlatformSecret(input.platformId, 'inference')
          : undefined;

      if (!apiKey && !inferenceApiKey) {
        return {
          success: false,
          error: 'Stored MaaS API key is missing. Paste the key again before duplicating.',
        };
      }

      return this.connectPlatform({
        platformId: duplicateId,
        apiKey: apiKey ?? undefined,
        inferenceApiKey: inferenceApiKey ?? undefined,
        displayName: input.displayName.trim() || source.displayName,
        endpoint: source.endpoint,
        websiteUrl: source.websiteUrl,
        description: source.description,
        logoUrl: source.logoUrl,
        envKey: source.envKey,
      });
    } catch (error) {
      log.error('Failed to duplicate MaaS Profile:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to duplicate MaaS Profile.',
      };
    }
  }

  async checkConnection(platformId: MaasPlatformId): Promise<MaasConnectionCheckResult> {
    const checkedAt = new Date().toISOString();
    const failedResult = (error: string): MaasConnectionCheckResult => ({
      ok: false,
      error,
      checkedAt,
      samples: [],
      averageLatencyMs: null,
    });
    try {
      if (!isMaasPlatformId(platformId)) {
        return failedResult('Unsupported MaaS platform.');
      }

      const settings = await appSettingsService.get('maas');
      const connection = getConnectedPlatform(settings, platformId);
      if (!connection) {
        return failedResult('Platform is not connected.');
      }

      const apiKey = await readPlatformSecret(
        platformId,
        getMaasPlatformTemplateId(platformId) === 'zenmux' ? 'inference' : 'primary'
      );
      if (!apiKey) {
        return failedResult('Stored API key is missing. Reconnect the platform to restore it.');
      }

      const modelsUrl = `${connection.endpoint.replace(/\/+$/, '')}/models`;
      const samples: MaasConnectionCheckResult['samples'] = [];
      for (let index = 0; index < 3; index += 1) {
        const startedAt = performance.now();
        try {
          const response = await net.fetch(modelsUrl, {
            headers: { Authorization: `Bearer ${apiKey}` },
            signal: AbortSignal.timeout(10_000),
          });
          const durationMs = Math.round((performance.now() - startedAt) * 10) / 10;
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          samples.push({ durationMs, ok: true, error: null });
        } catch (error) {
          samples.push({
            durationMs: Math.round((performance.now() - startedAt) * 10) / 10,
            ok: false,
            error: error instanceof Error ? error.message : 'Connectivity check failed.',
          });
        }
      }
      const successfulSamples = samples.filter((sample) => sample.ok);
      const averageLatencyMs =
        successfulSamples.length > 0
          ? Math.round(
              (successfulSamples.reduce((total, sample) => total + sample.durationMs, 0) /
                successfulSamples.length) *
                10
            ) / 10
          : null;
      const firstFailure = samples.find((sample) => !sample.ok)?.error ?? null;
      const result: MaasConnectionCheckResult = {
        ok: successfulSamples.length === 3,
        error: firstFailure,
        checkedAt,
        samples,
        averageLatencyMs,
      };
      await appSettingsService.update('maas', {
        connections: upsertConnection(settings.connections, {
          ...connection,
          lastCheckedAt: checkedAt,
          lastTest: result,
        }),
      });
      return result;
    } catch (error) {
      return failedResult(error instanceof Error ? error.message : 'Connectivity check failed.');
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
        if (runtimeId === 'codex' && binding) {
          await codexMaasAuthSwitch.disable({
            codexHome: resolveRuntimeStateDirectory('codex', config),
          });
        }
        await this.restoreRuntimeConfig(runtimeId, config, binding, platformId);
      }

      await deletePlatformSecrets(platformId);
      await appSettingsService.update('maas', {
        selectedPlatformId,
        connections,
        runtimeBindings: settings.runtimeBindings.filter(
          (binding) => binding.platformId !== platformId
        ),
      });
      this.recordsCacheByConnection.clear();
      telemetryService.capture('maas_platform_disconnected', {
        platform: getMaasPlatformTemplateId(platformId),
      });
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
        totalCreditsUsd: null,
        remainingCreditsUsd: null,
        keyLimitUsd: null,
        keyLimitRemainingUsd: null,
        usageDailyUsd: null,
        usageWeeklyUsd: null,
        usageMonthlyUsd: null,
        source: 'none',
        fetchedAt: null,
        period: null,
      };
    }

    if (getMaasPlatformTemplateId(input.platformId) === 'openrouter') {
      return this.fetchOpenRouterUsageSummary(
        getConnectedPlatform(settings, input.platformId)!,
        input.platformId
      );
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
      totalCreditsUsd: null,
      remainingCreditsUsd: null,
      keyLimitUsd: null,
      keyLimitRemainingUsd: null,
      usageDailyUsd: null,
      usageWeeklyUsd: null,
      usageMonthlyUsd: null,
      source: result.source,
      fetchedAt: result.fetchedAt,
      period: result.period,
    };
  }

  async listTextModelCandidates(forceRefresh = false): Promise<string[]> {
    const settings = await appSettingsService.get('maas');
    const zenmuxConnection = getConnectedPlatformByTemplate(settings, 'zenmux');
    if (!zenmuxConnection) return [];

    const result = await this.listRealRecords(settings, zenmuxConnection.platformId, forceRefresh);
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

    if (getMaasPlatformTemplateId(platformId) !== 'zenmux') {
      throw new Error(
        `${getMaasPlatformDefinition(platformId).name} real usage history is not available yet. ZenMux usage data is loaded from its Management API.`
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
    platformId: MaasPlatformTemplateId,
    forceRefresh: boolean
  ): Promise<MaasPlatformInfoSnapshot> {
    const platform = getMaasPlatformDefinition(platformId);
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
    platform: MaasPlatformDefinition
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
    const apiKey = await readPlatformSecret(connection.platformId, 'primary');
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

  private async fetchOpenRouterUsageSummary(
    connection: MaasPlatformConnection,
    platformId: MaasPlatformId
  ): Promise<MaasUsageSummary> {
    const apiKey = await readPlatformSecret(connection.platformId, 'primary');
    if (!apiKey) {
      throw new Error('OpenRouter API key is missing. Reconnect OpenRouter to read usage.');
    }

    const [keyResponse, creditsResponse] = await Promise.all([
      this.fetchOpenRouterUsageResource<OpenRouterKeyResponse>(
        openRouterUsageUrl(connection.endpoint, 'key'),
        apiKey
      ),
      this.fetchOpenRouterUsageResource<OpenRouterCreditsResponse>(
        openRouterUsageUrl(connection.endpoint, 'credits'),
        apiKey
      ),
    ]);

    return buildOpenRouterUsageSummary(
      platformId,
      keyResponse,
      creditsResponse,
      new Date().toISOString()
    );
  }

  private async fetchOpenRouterUsageResource<T extends { data?: unknown }>(
    url: URL,
    apiKey: string
  ): Promise<T> {
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    });

    let body: T | null = null;
    try {
      body = (await response.json()) as T;
    } catch {
      body = null;
    }

    if (!response.ok) {
      throw new Error(
        `OpenRouter usage API returned ${response.status}: ${getErrorMessage(
          body as ZenmuxErrorBody | null,
          response.statusText || 'Request failed.'
        )}`
      );
    }
    if (!body?.data) {
      throw new Error('OpenRouter usage API did not return an account payload.');
    }
    return body;
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
