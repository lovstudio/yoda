import { MAAS_PLATFORM_IDS, type MaasPlatformId } from './maas';
import {
  AGENT_ACCOUNT_PROVIDER_IDS,
  getDefaultPermissionModeId,
  isValidRuntimeId,
  type AgentAccountProviderId,
  type RuntimeId,
} from './runtime-registry';

export const DEFAULT_LLM_PROFILE_ID = 'default';
export const DEFAULT_LLM_PROFILE_NAME = 'Default profile';
export const DEFAULT_LLM_PROFILE_RUNTIME_ID: RuntimeId = 'claude';
export const DEFAULT_LLM_PROFILE_ACCESS_METHOD: AgentAccountProviderId = 'official-subscription';
export const DEFAULT_LLM_PROFILE_MAAS_PLATFORM_ID: MaasPlatformId = 'zenmux';

export const LLM_REASONING_EFFORT_IDS = ['default', 'low', 'medium', 'high'] as const;

export type LlmReasoningEffort = (typeof LLM_REASONING_EFFORT_IDS)[number];

export type LlmProfile = {
  id: string;
  name: string;
  runtimeId: RuntimeId;
  authProvider: AgentAccountProviderId;
  maasPlatformId: MaasPlatformId;
  model: string;
  reasoningEffort: LlmReasoningEffort;
  permissionMode: string;
};

export type GlobalLlmSettingsShape = {
  profiles: LlmProfile[];
  defaultProfileId: string;
  namingProfileId: string;
  promptTranslationEnabled: boolean;
  promptTranslationProfileId: string;
  promptTranslationShowOriginal: boolean;
};

export type GlobalLlmDebugInput = {
  prompt: string;
  profileId?: string;
};

export type GlobalLlmDebugResult = {
  success: boolean;
  profileId: string | null;
  profileName: string | null;
  runtimeId: RuntimeId | null;
  authProvider: AgentAccountProviderId | null;
  maasPlatformId: MaasPlatformId | null;
  model: string | null;
  output: string;
  durationMs: number;
  error?: string;
};

export const GLOBAL_LLM_MODEL_DISCOVERY_SOURCE_IDS = ['aiGateway', 'runtimeCatalog'] as const;

export type GlobalLlmModelDiscoverySource = (typeof GLOBAL_LLM_MODEL_DISCOVERY_SOURCE_IDS)[number];

export type GlobalLlmModelCandidate = {
  id: string;
  name: string | null;
  description: string | null;
  sources: GlobalLlmModelDiscoverySource[];
};

export type GlobalLlmModelDiscoverySourceStatus = {
  source: GlobalLlmModelDiscoverySource;
  ok: boolean;
  modelCount: number;
  error?: string;
};

export type GlobalLlmModelDiscoveryInput = {
  runtimeId: RuntimeId;
  authProvider: AgentAccountProviderId;
  maasPlatformId?: MaasPlatformId;
  forceRefresh?: boolean;
};

export type GlobalLlmModelDiscoveryResult = {
  runtimeId: RuntimeId;
  authProvider: AgentAccountProviderId;
  maasPlatformId: MaasPlatformId | null;
  models: GlobalLlmModelCandidate[];
  sources: GlobalLlmModelDiscoverySourceStatus[];
  fetchedAt: string;
};

type LegacyGlobalLlmSettingsShape = {
  maasEnabled?: boolean;
  maasModel?: string;
  agentEnabled?: boolean;
  agentId?: string;
  preferredProvider?: 'maas' | 'agent';
  promptTranslationEnabled?: boolean;
  promptTranslationShowOriginal?: boolean;
};

type PartialProfile = Partial<LlmProfile> & Record<string, unknown>;

export function createDefaultLlmProfile(overrides: Partial<LlmProfile> = {}): LlmProfile {
  const runtimeId = isValidRuntimeId(overrides.runtimeId)
    ? overrides.runtimeId
    : DEFAULT_LLM_PROFILE_RUNTIME_ID;
  return {
    id: sanitizeProfileId(overrides.id) || DEFAULT_LLM_PROFILE_ID,
    name: normalizeNonEmptyString(overrides.name) || DEFAULT_LLM_PROFILE_NAME,
    runtimeId,
    authProvider: isAgentAccountProviderId(overrides.authProvider)
      ? overrides.authProvider
      : DEFAULT_LLM_PROFILE_ACCESS_METHOD,
    maasPlatformId: isMaasPlatformId(overrides.maasPlatformId)
      ? overrides.maasPlatformId
      : DEFAULT_LLM_PROFILE_MAAS_PLATFORM_ID,
    model: typeof overrides.model === 'string' ? overrides.model.trim() : '',
    reasoningEffort: isLlmReasoningEffort(overrides.reasoningEffort)
      ? overrides.reasoningEffort
      : 'default',
    permissionMode:
      typeof overrides.permissionMode === 'string' && overrides.permissionMode.trim()
        ? overrides.permissionMode.trim()
        : getDefaultPermissionModeId(runtimeId),
  };
}

export function normalizeLlmSettings(
  value: Partial<GlobalLlmSettingsShape> | LegacyGlobalLlmSettingsShape | null | undefined
): GlobalLlmSettingsShape {
  const raw: Record<string, unknown> = isRecord(value) ? value : {};
  const existingProfiles = Array.isArray(raw.profiles) ? raw.profiles : [];
  const useLegacyProfile =
    hasLegacyRoutingFields(raw) &&
    (existingProfiles.length === 0 || looksLikeDefaultProfileList(existingProfiles));
  const rawProfiles = useLegacyProfile
    ? [legacySettingsToProfile(raw as LegacyGlobalLlmSettingsShape)]
    : existingProfiles.length
      ? existingProfiles
      : [legacySettingsToProfile(raw as LegacyGlobalLlmSettingsShape)];
  const profiles = dedupeProfiles(
    rawProfiles
      .map((profile, index) => normalizeProfile(profile as PartialProfile, index))
      .filter((profile): profile is LlmProfile => Boolean(profile))
  );
  const safeProfiles = profiles.length ? profiles : [createDefaultLlmProfile()];
  const defaultProfileId = normalizeProfileSelection(raw.defaultProfileId, safeProfiles);
  return {
    profiles: safeProfiles,
    defaultProfileId,
    namingProfileId: normalizeProfileSelection(raw.namingProfileId, safeProfiles, defaultProfileId),
    promptTranslationEnabled:
      typeof raw.promptTranslationEnabled === 'boolean' ? raw.promptTranslationEnabled : false,
    promptTranslationProfileId: normalizeProfileSelection(
      raw.promptTranslationProfileId,
      safeProfiles,
      defaultProfileId
    ),
    promptTranslationShowOriginal:
      typeof raw.promptTranslationShowOriginal === 'boolean'
        ? raw.promptTranslationShowOriginal
        : true,
  };
}

export function getLlmProfile(
  settings: Partial<GlobalLlmSettingsShape> | LegacyGlobalLlmSettingsShape | null | undefined,
  profileId?: string | null
): LlmProfile {
  const normalized = normalizeLlmSettings(settings);
  const requested = profileId
    ? normalized.profiles.find((profile) => profile.id === profileId)
    : null;
  return (
    requested ??
    normalized.profiles.find((profile) => profile.id === normalized.defaultProfileId) ??
    normalized.profiles[0] ??
    createDefaultLlmProfile()
  );
}

export function isLlmReasoningEffort(value: unknown): value is LlmReasoningEffort {
  return (
    typeof value === 'string' && LLM_REASONING_EFFORT_IDS.includes(value as LlmReasoningEffort)
  );
}

function legacySettingsToProfile(settings: LegacyGlobalLlmSettingsShape): LlmProfile {
  return createDefaultLlmProfile({
    id: DEFAULT_LLM_PROFILE_ID,
    name: DEFAULT_LLM_PROFILE_NAME,
    authProvider: settings.maasEnabled ? 'yoda-maas' : DEFAULT_LLM_PROFILE_ACCESS_METHOD,
    model: settings.maasModel ?? '',
  });
}

function hasLegacyRoutingFields(value: Record<string, unknown>): boolean {
  return (
    'maasEnabled' in value ||
    'maasModel' in value ||
    'agentEnabled' in value ||
    'agentId' in value ||
    'preferredProvider' in value
  );
}

function looksLikeDefaultProfileList(values: unknown[]): boolean {
  if (values.length !== 1) return false;
  const profile = values[0];
  if (!isRecord(profile)) return false;
  return (
    (!profile.id || profile.id === DEFAULT_LLM_PROFILE_ID) &&
    (!profile.authProvider || profile.authProvider === DEFAULT_LLM_PROFILE_ACCESS_METHOD) &&
    (!profile.maasPlatformId || profile.maasPlatformId === DEFAULT_LLM_PROFILE_MAAS_PLATFORM_ID) &&
    (!profile.model || profile.model === '')
  );
}

function normalizeProfile(value: PartialProfile, index: number): LlmProfile | null {
  if (!isRecord(value)) return null;
  const fallbackId = index === 0 ? DEFAULT_LLM_PROFILE_ID : `profile-${index + 1}`;
  return createDefaultLlmProfile({
    id: sanitizeProfileId(value.id) || fallbackId,
    name: normalizeNonEmptyString(value.name) || `Profile ${index + 1}`,
    runtimeId: value.runtimeId as RuntimeId,
    authProvider: value.authProvider as AgentAccountProviderId,
    maasPlatformId: value.maasPlatformId as MaasPlatformId,
    model: value.model as string,
    reasoningEffort: value.reasoningEffort as LlmReasoningEffort,
    permissionMode: value.permissionMode as string,
  });
}

function dedupeProfiles(profiles: LlmProfile[]): LlmProfile[] {
  const seen = new Set<string>();
  return profiles.map((profile, index) => {
    let id = profile.id || (index === 0 ? DEFAULT_LLM_PROFILE_ID : `profile-${index + 1}`);
    while (seen.has(id)) id = `${id}-${index + 1}`;
    seen.add(id);
    return { ...profile, id };
  });
}

function normalizeProfileSelection(
  value: unknown,
  profiles: LlmProfile[],
  fallbackId = profiles[0]?.id ?? DEFAULT_LLM_PROFILE_ID
): string {
  const id = typeof value === 'string' ? value : '';
  return profiles.some((profile) => profile.id === id) ? id : fallbackId;
}

function sanitizeProfileId(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '-')
    .slice(0, 80);
}

function normalizeNonEmptyString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function isAgentAccountProviderId(value: unknown): value is AgentAccountProviderId {
  return (
    typeof value === 'string' &&
    AGENT_ACCOUNT_PROVIDER_IDS.includes(value as AgentAccountProviderId)
  );
}

function isMaasPlatformId(value: unknown): value is MaasPlatformId {
  return typeof value === 'string' && MAAS_PLATFORM_IDS.includes(value as MaasPlatformId);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
