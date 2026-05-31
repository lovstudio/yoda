import type { MaasSettings } from '@shared/app-settings';
import {
  MAAS_PLATFORM_IDS,
  MAAS_PLATFORMS,
  type MaasConnectInput,
  type MaasConnection,
  type MaasInvocationFilterKind,
  type MaasInvocationKind,
  type MaasInvocationPage,
  type MaasInvocationRecord,
  type MaasPlatformConnection,
  type MaasPlatformId,
} from '@shared/maas';
import { TTLCache } from '@main/core/utils/ttl-cache';
import { log } from '@main/lib/logger';
import { telemetryService } from '@main/lib/telemetry';
import { encryptedAppSecretsStore } from '../secrets/encrypted-app-secrets-store';
import { appSettingsService } from '../settings/settings-service';

const SECRET_PREFIX = 'yoda-maas-token';
const REAL_RECORDS_CACHE_TTL_MS = 30_000;
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

type RealRecordsResult = Pick<MaasInvocationPage, 'source' | 'fetchedAt' | 'period'> & {
  records: MaasInvocationRecord[];
};

function isMaasPlatformId(value: string): value is MaasPlatformId {
  return (MAAS_PLATFORM_IDS as readonly string[]).includes(value);
}

function secretKey(platformId: MaasPlatformId): string {
  return `${SECRET_PREFIX}:${platformId}`;
}

function keyFingerprint(apiKey: string): string {
  const trimmed = apiKey.trim();
  if (trimmed.length <= 4) return 'configured';
  return `...${trimmed.slice(-4)}`;
}

function defaultConnection(platformId: MaasPlatformId): MaasConnection {
  const platform = MAAS_PLATFORMS[platformId];
  return {
    platformId,
    displayName: platform.name,
    endpoint: platform.defaultEndpoint,
    keyFingerprint: null,
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

function getErrorMessage(body: ZenmuxTimeseriesResponse | null, fallback: string): string {
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

export class MaasService {
  private readonly recordsCacheByConnection = new Map<string, TTLCache<RealRecordsResult>>();

  async listConnections(): Promise<MaasConnection[]> {
    const settings = await appSettingsService.get('maas');
    return MAAS_PLATFORM_IDS.map((platformId) =>
      toConnection(getConnectedPlatform(settings, platformId), platformId)
    );
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
      if (!apiKey && !existing?.keyFingerprint) {
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
      }

      const now = new Date().toISOString();
      const connection: MaasPlatformConnection = {
        platformId: input.platformId,
        displayName: input.displayName?.trim() || platform.name,
        endpoint: input.endpoint?.trim() || platform.defaultEndpoint,
        keyFingerprint: apiKey ? keyFingerprint(apiKey) : (existing?.keyFingerprint ?? null),
        connectedAt: existing?.connectedAt ?? now,
        lastCheckedAt: now,
      };

      if (apiKey) {
        await encryptedAppSecretsStore.setSecret(secretKey(input.platformId), apiKey);
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

      await encryptedAppSecretsStore.deleteSecret(secretKey(platformId));
      await appSettingsService.update('maas', {
        selectedPlatformId,
        connections,
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
}

export const maasService = new MaasService();
