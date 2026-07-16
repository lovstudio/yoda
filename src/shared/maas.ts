import type { AgentAccountProviderId, RuntimeId } from './runtime-registry';

export const MAAS_PLATFORM_IDS = ['zenmux', 'openrouter', 'siliconflow', 'custom'] as const;

export type MaasPlatformId = (typeof MAAS_PLATFORM_IDS)[number];

export const MAAS_INVOCATION_KINDS = ['text', 'image', 'embedding', 'video'] as const;

export type MaasInvocationKind = (typeof MAAS_INVOCATION_KINDS)[number];
export type MaasInvocationFilterKind = MaasInvocationKind | 'all';
export type MaasInvocationStatus = 'succeeded' | 'failed' | 'streaming';

export type MaasPlatformConnection = {
  platformId: MaasPlatformId;
  displayName: string;
  endpoint: string;
  keyFingerprint: string | null;
  inferenceKeyFingerprint: string | null;
  connectedAt: string | null;
  lastCheckedAt: string | null;
};

export type MaasConnection = MaasPlatformConnection & {
  connected: boolean;
  error: string | null;
};

export function hasMaasInferenceCredential(connection: MaasConnection): boolean {
  return Boolean(
    connection.platformId === 'zenmux'
      ? connection.inferenceKeyFingerprint
      : connection.keyFingerprint
  );
}

export function supportsMaasPlatformForRuntime(
  runtimeId: RuntimeId,
  platformId: MaasPlatformId
): boolean {
  if (runtimeId === 'codex') return true;
  if (runtimeId === 'claude') {
    return platformId === 'zenmux' || platformId === 'openrouter';
  }
  return false;
}

export type MaasConnectInput = {
  platformId: MaasPlatformId;
  apiKey?: string;
  inferenceApiKey?: string;
  displayName?: string;
  endpoint?: string;
};

export type MaasApiKeyKind = 'primary' | 'inference';

export type MaasCopyStoredApiKeyInput = {
  platformId: MaasPlatformId;
  kind: MaasApiKeyKind;
};

export type MaasConnectionCheckResult = {
  ok: boolean;
  error: string | null;
  checkedAt: string;
};

export type MaasRuntimeBinding = {
  runtimeId: RuntimeId;
  platformId: MaasPlatformId;
  previousAuthProvider: AgentAccountProviderId | null;
  previousMaasPlatformId: MaasPlatformId | null;
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

export type MaasPlatformDefinition = {
  id: MaasPlatformId;
  name: string;
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

export const MAAS_PLATFORMS: Record<MaasPlatformId, MaasPlatformDefinition> = {
  zenmux: {
    id: 'zenmux',
    name: 'ZenMux',
    description: 'Use a unified API standard to invoke models from different providers.',
    defaultEndpoint: 'https://zenmux.ai/api/v1',
    docsUrl: 'https://zenmux.ai/docs/',
    officialDescriptionUrl: 'https://zenmux.ai/docs/',
    capabilities: ['text', 'image', 'embedding', 'video'],
  },
  openrouter: {
    id: 'openrouter',
    name: 'OpenRouter',
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
    description: 'Use SiliconFlow API to call GenAI capabilities; call via OpenAI interface.',
    defaultEndpoint: 'https://api.siliconflow.cn/v1',
    docsUrl: 'https://docs.siliconflow.cn/',
    officialDescriptionUrl: 'https://docs.siliconflow.cn/',
    capabilities: ['text', 'embedding', 'image'],
  },
  custom: {
    id: 'custom',
    name: 'Custom OpenAI',
    description: 'Creates a model response for the given chat conversation.',
    defaultEndpoint: 'https://api.example.com/v1',
    docsUrl: 'https://platform.openai.com/docs/api-reference',
    officialDescriptionUrl: 'https://platform.openai.com/docs/api-reference',
    capabilities: ['text', 'image', 'embedding'],
  },
};
