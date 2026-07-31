import type { RuntimeId } from './runtime-registry';

export const RUNTIME_MODEL_CANDIDATE_CACHE_SOURCES = [
  'catalog',
  'officialApi',
  'zenmux',
  'docs',
  'cli',
] as const;

export const RUNTIME_MODEL_CANDIDATE_SOURCES = [...RUNTIME_MODEL_CANDIDATE_CACHE_SOURCES] as const;

export type RuntimeModelCandidateCacheSource =
  (typeof RUNTIME_MODEL_CANDIDATE_CACHE_SOURCES)[number];
export type RuntimeModelCandidateSource = (typeof RUNTIME_MODEL_CANDIDATE_SOURCES)[number];

export type AgentModelCandidateCacheEntry = {
  source: RuntimeModelCandidateCacheSource;
  models: string[];
  fetchedAt: string;
  expiresAt: string;
  error?: string;
};

export type AgentModelCandidateItem = {
  id: string;
  visible: boolean;
  sources: RuntimeModelCandidateSource[];
};

export type AgentModelCandidateProviderSettings = {
  sources: AgentModelCandidateCacheEntry[];
  hiddenModels: string[];
};

export type RuntimeModelCandidatesSettings = {
  runtimes: Partial<Record<RuntimeId, AgentModelCandidateProviderSettings>>;
};

export type AgentModelCandidateInferenceResult = {
  runtimeId: RuntimeId;
  models: AgentModelCandidateItem[];
  candidates: string[];
  sources: AgentModelCandidateCacheEntry[];
  hiddenModels: string[];
  cached: boolean;
};
