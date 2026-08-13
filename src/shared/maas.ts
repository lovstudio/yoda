import type { RuntimeCustomConfig } from './app-settings';
import type { AgentAccountProviderId, RuntimeId } from './runtime-registry';

export const MAAS_PLATFORM_IDS = [
  'zenmux',
  'openrouter',
  'siliconflow',
  'litellm',
  'newapi',
  'cliproxyapi',
  'custom',
] as const;

export const MAAS_MANAGED_GATEWAY_IDS = ['litellm', 'cliproxyapi', 'newapi'] as const;

export type MaasManagedGatewayId = (typeof MAAS_MANAGED_GATEWAY_IDS)[number];

export type MaasManagedGatewayRepository = {
  repository: string;
  url: string;
};

export const MAAS_MANAGED_GATEWAY_REPOSITORIES: Record<
  MaasManagedGatewayId,
  MaasManagedGatewayRepository
> = {
  litellm: {
    repository: 'BerriAI/litellm',
    url: 'https://github.com/BerriAI/litellm',
  },
  cliproxyapi: {
    repository: 'router-for-me/CLIProxyAPI',
    url: 'https://github.com/router-for-me/CLIProxyAPI',
  },
  newapi: {
    repository: 'QuantumNous/new-api',
    url: 'https://github.com/QuantumNous/new-api',
  },
};

export type MaasManagedGatewayStarTrendPoint = {
  date: string;
  starCount: number;
};

export type MaasManagedGatewayStarTrend = {
  points: MaasManagedGatewayStarTrendPoint[];
  source: 'ossinsight';
  calibratedToCurrent: boolean;
  fetchedAt: string;
};

export type MaasManagedGatewayStarSnapshot = {
  platformId: MaasManagedGatewayId;
  repositoryUrl: string;
  starCount: number | null;
  fetchedAt: string | null;
  trend: MaasManagedGatewayStarTrend | null;
};

export type MaasPlatformTemplateId = (typeof MAAS_PLATFORM_IDS)[number];
export type MaasProfileId = `profile:${string}`;
export type LegacyMaasProfileId = `${MaasPlatformTemplateId}:${string}`;
/** @deprecated Use MaasProfileId. Retained for persisted pre-profile IDs. */
export type CustomMaasPlatformId = `custom:${string}` | MaasProfileId;
export type MaasPlatformId = MaasPlatformTemplateId | MaasProfileId | LegacyMaasProfileId;

const CUSTOM_MAAS_PLATFORM_PREFIX = 'custom:';
const MAAS_PROFILE_PREFIX = 'profile:';
const LEGACY_CLOUD_PROFILE_IDS = new Set(['zenmux', 'openrouter', 'siliconflow', 'custom']);

export function migrateLegacyMaasPlatformId(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  if (value.startsWith(MAAS_PROFILE_PREFIX)) return value;
  const prefix = value.split(':', 1)[0] ?? '';
  if (!LEGACY_CLOUD_PROFILE_IDS.has(prefix)) return value;
  if (value.includes(':') && value.endsWith(':')) return value;
  return `${MAAS_PROFILE_PREFIX}${value}`;
}

export function getLegacyMaasPlatformId(platformId: MaasPlatformId): LegacyMaasProfileId | null {
  if (!platformId.startsWith(MAAS_PROFILE_PREFIX)) return null;
  const legacyId = platformId.slice(MAAS_PROFILE_PREFIX.length);
  const prefix = legacyId.split(':', 1)[0] ?? '';
  return LEGACY_CLOUD_PROFILE_IDS.has(prefix) ? (legacyId as LegacyMaasProfileId) : null;
}

export function isMaasPlatformId(value: unknown): value is MaasPlatformId {
  if (typeof value !== 'string') return false;
  if ((MAAS_PLATFORM_IDS as readonly string[]).includes(value)) return true;
  const separatorIndex = value.indexOf(':');
  if (separatorIndex <= 0 || separatorIndex === value.length - 1) return false;
  if (value.startsWith(MAAS_PROFILE_PREFIX)) return true;
  return (MAAS_PLATFORM_IDS as readonly string[]).includes(value.slice(0, separatorIndex));
}

export function isCustomMaasPlatformId(
  platformId: MaasPlatformId
): platformId is 'custom' | CustomMaasPlatformId {
  return (
    platformId === 'custom' ||
    platformId.startsWith(CUSTOM_MAAS_PLATFORM_PREFIX) ||
    platformId.startsWith(MAAS_PROFILE_PREFIX)
  );
}

export function getMaasPlatformTemplateId(platformId: MaasPlatformId): MaasPlatformTemplateId {
  if (platformId.startsWith(MAAS_PROFILE_PREFIX)) {
    const legacyId = getLegacyMaasPlatformId(platformId);
    return legacyId ? (legacyId.split(':', 1)[0] as MaasPlatformTemplateId) : 'custom';
  }
  const separatorIndex = platformId.indexOf(':');
  return (
    separatorIndex < 0 ? platformId : platformId.slice(0, separatorIndex)
  ) as MaasPlatformTemplateId;
}

export function createMaasProfileId(uuid: string = globalThis.crypto.randomUUID()): MaasProfileId {
  return `profile:${uuid}`;
}

export function createCustomMaasPlatformId(
  uuid: string = globalThis.crypto.randomUUID()
): CustomMaasPlatformId {
  return createMaasProfileId(uuid);
}

export const MAAS_INVOCATION_KINDS = ['text', 'image', 'embedding', 'video'] as const;

export type MaasInvocationKind = (typeof MAAS_INVOCATION_KINDS)[number];
export type MaasInvocationFilterKind = MaasInvocationKind | 'all';
export type MaasInvocationStatus = 'succeeded' | 'failed' | 'streaming';

export type MaasPlatformConnection = {
  platformId: MaasPlatformId;
  displayName: string;
  endpoint: string;
  websiteUrl?: string;
  description?: string;
  logoUrl?: string;
  envKey?: string;
  /** @deprecated Legacy per-Profile external sync consent. */
  syncToAgentClient?: boolean;
  /** @deprecated Legacy per-Profile external sync consent version. */
  syncToAgentClientVersion?: 1;
  keyFingerprint: string | null;
  inferenceKeyFingerprint: string | null;
  connectedAt: string | null;
  lastCheckedAt: string | null;
  lastTest: MaasConnectionCheckResult | null;
};

export type MaasConnection = MaasPlatformConnection & {
  configured: boolean;
  connected: boolean;
  error: string | null;
};

export function hasMaasInferenceCredential(connection: MaasConnection): boolean {
  const templateId = getMaasPlatformTemplateId(connection.platformId);
  return Boolean(
    templateId === 'zenmux' ? connection.inferenceKeyFingerprint : connection.keyFingerprint
  );
}

export function supportsMaasPlatformForRuntime(
  runtimeId: RuntimeId,
  platformId: MaasPlatformId
): boolean {
  if (runtimeId === 'codex') return true;
  if (runtimeId === 'claude') {
    const templateId = getMaasPlatformTemplateId(platformId);
    return templateId === 'zenmux' || templateId === 'openrouter';
  }
  return false;
}

export type MaasConnectInput = {
  platformId: MaasPlatformId;
  apiKey?: string;
  inferenceApiKey?: string;
  displayName?: string;
  endpoint?: string;
  websiteUrl?: string;
  description?: string;
  logoUrl?: string;
  envKey?: string;
  /** @deprecated External Agent sync is now a global MaaS setting. */
  syncToAgentClient?: boolean;
};

export type MaasProfileWebsiteMetadata = {
  websiteUrl: string;
  name: string | null;
  description: string | null;
  logoUrl: string | null;
};

export type MaasProfileWebsiteInspection =
  | { success: true; metadata: MaasProfileWebsiteMetadata }
  | { success: false; error: string };

export type MaasSetCodexClientSyncInput = {
  /** @deprecated Sync is global; retained for older renderer callers. */
  platformId?: MaasPlatformId;
  enabled: boolean;
  loginItemEnabled?: boolean;
};

export type MaasCodexClientSyncStatus = {
  supported: boolean;
  enabled: boolean;
  managed: boolean;
  configManaged: boolean;
  environmentPublished: boolean;
  persistentCredentialStored: boolean;
  loginItemEnabled: boolean;
  platformId: MaasPlatformId | null;
  displayName: string | null;
  envKey: string | null;
  persistsAfterQuit: boolean;
};

const DEFAULT_MAAS_ENV_KEYS: Record<MaasPlatformTemplateId, string> = {
  zenmux: 'ZENMUX_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
  siliconflow: 'SILICONFLOW_API_KEY',
  litellm: 'LITELLM_API_KEY',
  newapi: 'NEW_API_API_KEY',
  cliproxyapi: 'CLIPROXYAPI_API_KEY',
  custom: 'CUSTOM_MAAS_API_KEY',
};

export function isValidMaasEnvKey(value: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(value);
}

export function resolveMaasEnvKey(
  platformId: MaasPlatformId,
  displayName?: string,
  configuredEnvKey?: string
): string {
  const explicit = configuredEnvKey?.trim();
  if (explicit) return explicit;
  const templateId = getMaasPlatformTemplateId(platformId);
  const nameKey = displayName
    ?.trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return nameKey ? `${nameKey}_API_KEY` : DEFAULT_MAAS_ENV_KEYS[templateId];
}

export type MaasApiKeyKind = 'primary' | 'inference';

export type MaasCopyStoredApiKeyInput = {
  platformId: MaasPlatformId;
  kind: MaasApiKeyKind;
};

export type MaasConnectionCheckResult = {
  ok: boolean;
  error: string | null;
  checkedAt: string;
  samples: Array<{
    durationMs: number;
    ok: boolean;
    error: string | null;
  }>;
  averageLatencyMs: number | null;
};

export type MaasRuntimeBinding = {
  runtimeId: RuntimeId;
  platformId: MaasPlatformId;
  previousAuthProvider: AgentAccountProviderId | null;
  previousMaasPlatformId: MaasPlatformId | null;
  previousConfig?: RuntimeCustomConfig;
  enabledAt: string;
};

export type MaasRuntimeBindingStatus = {
  runtimeId: string;
  platformId: MaasPlatformId | null;
  supported: boolean;
  bound: boolean;
  effective: boolean;
  connected: boolean;
  enabledAt: string | null;
};

export type MaasSetRuntimeBindingInput = {
  runtimeId: string;
  platformId: MaasPlatformId;
  enabled: boolean;
};

export type MaasGlobalBindingStatus = {
  platformId: MaasPlatformId | null;
  enabled: boolean;
  effective: boolean;
  runtimeIds: RuntimeId[];
};

export type MaasSetGlobalBindingInput = {
  platformId: MaasPlatformId;
  enabled: boolean;
};

export const MAAS_PLATFORM_CATEGORIES = [
  'hosted-platform',
  'self-hosted-gateway',
  'custom',
] as const;

export type MaasPlatformCategory = (typeof MAAS_PLATFORM_CATEGORIES)[number];

export type MaasPlatformDefinition = {
  id: MaasPlatformTemplateId;
  name: string;
  category: MaasPlatformCategory;
  description: string;
  defaultEndpoint: string;
  docsUrl: string;
  officialDescriptionUrl: string;
  capabilities: MaasInvocationKind[];
};

export type MaasPlatformDescriptionSource = 'official-meta' | 'official-body-summary' | 'fallback';

export type MaasPlatformOfficialDescription = {
  platformId: MaasPlatformId;
  description: string;
  source: MaasPlatformDescriptionSource;
  sourceUrl: string | null;
  fetchedAt: string | null;
  metaDescription: string | null;
  bodySummary: string | null;
  bodyTextExcerpt: string | null;
  bodyCharCount: number | null;
  error: string | null;
};

export type MaasPlatformInfoSnapshot = MaasPlatformOfficialDescription & {
  version: number;
  bodyText: string | null;
};

export type MaasInvocationRecord = {
  id: string;
  platformId: MaasPlatformId;
  kind: MaasInvocationKind;
  title: string;
  prompt: string;
  outputSummary: string;
  model: string;
  provider: string;
  createdAt: string;
  status: MaasInvocationStatus;
  previewUrl: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
  latencyMs: number | null;
  durationMs: number | null;
  assetCount: number | null;
  dimensions: string | null;
};

export type MaasInvocationPage = {
  records: MaasInvocationRecord[];
  nextOffset: number | null;
  total: number;
  source: 'none' | 'zenmux-management-statistics';
  fetchedAt: string | null;
  period: {
    startingAt: string;
    endingAt: string;
  } | null;
};

export type MaasUsageSummaryInput = {
  platformId: MaasPlatformId;
  kind?: MaasInvocationFilterKind;
  providerHints?: readonly string[];
  modelHints?: readonly string[];
  forceRefresh?: boolean;
};

export type MaasUsageSummary = {
  platformId: MaasPlatformId;
  recordCount: number;
  totalRecords: number;
  totalInputTokens: number | null;
  totalOutputTokens: number | null;
  totalCostUsd: number | null;
  source: MaasInvocationPage['source'];
  fetchedAt: string | null;
  period: MaasInvocationPage['period'];
};

export const MAAS_PLATFORMS: Record<MaasPlatformTemplateId, MaasPlatformDefinition> = {
  zenmux: {
    id: 'zenmux',
    name: 'ZenMux',
    category: 'hosted-platform',
    description: 'Use a unified API standard to invoke models from different providers.',
    defaultEndpoint: 'https://zenmux.ai/api/v1',
    docsUrl: 'https://zenmux.ai/docs/',
    officialDescriptionUrl: 'https://zenmux.ai/docs/',
    capabilities: ['text', 'image', 'embedding', 'video'],
  },
  openrouter: {
    id: 'openrouter',
    name: 'OpenRouter',
    category: 'hosted-platform',
    description:
      'Access hundreds of AI models through a single endpoint, while automatically handling fallbacks.',
    defaultEndpoint: 'https://openrouter.ai/api/v1',
    docsUrl: 'https://openrouter.ai/docs',
    officialDescriptionUrl: 'https://openrouter.ai/docs',
    capabilities: ['text', 'image'],
  },
  siliconflow: {
    id: 'siliconflow',
    name: 'SiliconFlow',
    category: 'hosted-platform',
    description: 'Use SiliconFlow API to call GenAI capabilities; call via OpenAI interface.',
    defaultEndpoint: 'https://api.siliconflow.cn/v1',
    docsUrl: 'https://docs.siliconflow.cn/',
    officialDescriptionUrl: 'https://docs.siliconflow.cn/',
    capabilities: ['text', 'embedding', 'image'],
  },
  litellm: {
    id: 'litellm',
    name: 'LiteLLM',
    category: 'self-hosted-gateway',
    description:
      'Connect to a LiteLLM Gateway that routes requests across multiple model providers with load balancing and fallbacks.',
    defaultEndpoint: 'http://127.0.0.1:4000/v1',
    docsUrl: 'https://docs.litellm.ai/',
    officialDescriptionUrl: 'https://docs.litellm.ai/',
    capabilities: ['text', 'image', 'embedding'],
  },
  newapi: {
    id: 'newapi',
    name: 'New API',
    category: 'self-hosted-gateway',
    description:
      'Manage OpenAI-compatible upstream channels through a lightweight local gateway with routing and failover.',
    defaultEndpoint: 'http://127.0.0.1:4001/v1',
    docsUrl: 'https://docs.newapi.pro/',
    officialDescriptionUrl: 'https://docs.newapi.pro/',
    capabilities: ['text', 'image', 'embedding'],
  },
  cliproxyapi: {
    id: 'cliproxyapi',
    name: 'CLIProxyAPI',
    category: 'self-hosted-gateway',
    description:
      'Expose CLI and OAuth accounts through OpenAI, Gemini, Claude, and Codex-compatible APIs with multi-account routing.',
    defaultEndpoint: 'http://127.0.0.1:8317/v1',
    docsUrl: 'https://github.com/router-for-me/CLIProxyAPI',
    officialDescriptionUrl: 'https://github.com/router-for-me/CLIProxyAPI',
    capabilities: ['text', 'image'],
  },
  custom: {
    id: 'custom',
    name: 'Custom',
    category: 'custom',
    description: 'Connect a custom OpenAI-compatible model platform.',
    defaultEndpoint: 'https://api.example.com/v1',
    docsUrl: 'https://platform.openai.com/docs/api-reference',
    officialDescriptionUrl: 'https://platform.openai.com/docs/api-reference',
    capabilities: ['text', 'image', 'embedding'],
  },
};

export function getMaasPlatformDefinition(platformId: MaasPlatformId): MaasPlatformDefinition {
  return MAAS_PLATFORMS[getMaasPlatformTemplateId(platformId)];
}
