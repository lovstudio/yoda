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
  connectedAt: string | null;
  lastCheckedAt: string | null;
};

export type MaasConnection = MaasPlatformConnection & {
  connected: boolean;
  error: string | null;
};

export type MaasConnectInput = {
  platformId: MaasPlatformId;
  apiKey?: string;
  displayName?: string;
  endpoint?: string;
};

export type MaasPlatformDefinition = {
  id: MaasPlatformId;
  name: string;
  description: string;
  defaultEndpoint: string;
  docsUrl: string;
  capabilities: MaasInvocationKind[];
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

export const MAAS_PLATFORMS: Record<MaasPlatformId, MaasPlatformDefinition> = {
  zenmux: {
    id: 'zenmux',
    name: 'ZenMux',
    description: 'Unified routing, observability, and billing across model providers.',
    defaultEndpoint: 'https://zenmux.ai/api/v1',
    docsUrl: 'https://zenmux.ai/docs/',
    capabilities: ['text', 'image', 'embedding', 'video'],
  },
  openrouter: {
    id: 'openrouter',
    name: 'OpenRouter',
    description: 'OpenAI-compatible model routing with provider fallback.',
    defaultEndpoint: 'https://openrouter.ai/api/v1',
    docsUrl: 'https://openrouter.ai/docs',
    capabilities: ['text', 'image'],
  },
  siliconflow: {
    id: 'siliconflow',
    name: 'SiliconFlow',
    description: 'Hosted open model APIs for text and embedding workloads.',
    defaultEndpoint: 'https://api.siliconflow.cn/v1',
    docsUrl: 'https://docs.siliconflow.cn/',
    capabilities: ['text', 'embedding', 'image'],
  },
  custom: {
    id: 'custom',
    name: 'Custom OpenAI',
    description: 'Any OpenAI-compatible MaaS endpoint managed by your team.',
    defaultEndpoint: 'https://api.example.com/v1',
    docsUrl: 'https://platform.openai.com/docs/api-reference',
    capabilities: ['text', 'image', 'embedding'],
  },
};
