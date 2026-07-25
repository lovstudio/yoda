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
  return {
    ...metadata,
    name: displayName?.trim() || getMaasPlatformDefinition(platformId).name,
  };
}
