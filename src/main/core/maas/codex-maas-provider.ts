import { getMaasPlatformDefinition, type MaasPlatformId } from '@shared/maas';

export const CODEX_SHARED_PROVIDER_ID = 'custom';

export type CodexMaasProviderSpec = {
  providerId: typeof CODEX_SHARED_PROVIDER_ID;
  name: string;
};

export function resolveCodexMaasProviderSpec(
  platformId: MaasPlatformId,
  displayName?: string
): CodexMaasProviderSpec {
  const fallbackName = getMaasPlatformDefinition(platformId).name;
  const requestedName = displayName?.trim() || fallbackName;
  return {
    // Codex filters its history by the exact model_provider string. Keep one
    // stable bucket while the account or MaaS route changes so the same thread
    // remains visible and resumable across providers.
    providerId: CODEX_SHARED_PROVIDER_ID,
    // Codex identifies its first-party provider by the display name "OpenAI".
    // Never let a third-party connection accidentally opt into OpenAI-only
    // request fields such as reasoning_summary_delivery=sequential_cutoff.
    name: requestedName.toLowerCase() === 'openai' ? fallbackName : requestedName,
  };
}
