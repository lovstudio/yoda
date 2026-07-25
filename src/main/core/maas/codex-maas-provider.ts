import {
  getMaasPlatformDefinition,
  getMaasPlatformTemplateId,
  type MaasPlatformId,
  type MaasPlatformTemplateId,
} from '@shared/maas';

type CodexMaasProviderMetadata = {
  providerId: string;
  envKey: string;
};

const CODEX_MAAS_PROVIDER_METADATA: Record<MaasPlatformTemplateId, CodexMaasProviderMetadata> = {
  zenmux: {
    providerId: 'zenmux',
    envKey: 'ZENMUX_API_KEY',
  },
  openrouter: {
    providerId: 'openrouter',
    envKey: 'OPENROUTER_API_KEY',
  },
  siliconflow: {
    providerId: 'siliconflow',
    envKey: 'SILICONFLOW_API_KEY',
  },
  custom: {
    providerId: 'custom',
    envKey: 'CUSTOM_API_KEY',
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
