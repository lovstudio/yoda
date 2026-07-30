import {
  getMaasPlatformDefinition,
  getMaasPlatformTemplateId,
  type MaasPlatformId,
  type MaasPlatformTemplateId,
} from '@shared/maas';

type CodexMaasProviderMetadata = {
  providerId: string;
};

const CODEX_MAAS_PROVIDER_METADATA: Record<MaasPlatformTemplateId, CodexMaasProviderMetadata> = {
  zenmux: {
    providerId: 'zenmux',
  },
  openrouter: {
    providerId: 'openrouter',
  },
  siliconflow: {
    providerId: 'siliconflow',
  },
  litellm: {
    providerId: 'litellm',
  },
  newapi: {
    providerId: 'newapi',
  },
  custom: {
    providerId: 'custom',
  },
};

export type CodexMaasProviderSpec = CodexMaasProviderMetadata & {
  name: string;
};

export function resolveCodexMaasProviderSpec(
  platformId: MaasPlatformId,
  displayName?: string
): CodexMaasProviderSpec {
  const templateId = getMaasPlatformTemplateId(platformId);
  const metadata = CODEX_MAAS_PROVIDER_METADATA[templateId];
  const fallbackName = getMaasPlatformDefinition(platformId).name;
  const requestedName = displayName?.trim() || fallbackName;
  return {
    ...metadata,
    // Codex identifies its first-party provider by the display name "OpenAI".
    // Never let a third-party connection accidentally opt into OpenAI-only
    // request fields such as reasoning_summary_delivery=sequential_cutoff.
    name: requestedName.toLowerCase() === 'openai' ? fallbackName : requestedName,
  };
}
