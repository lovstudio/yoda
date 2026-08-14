import {
  getMaasPlatformDefinition,
  resolveMaasEnvKey,
  type MaasConnection,
  type MaasGlobalBindingStatus,
} from '@shared/maas';
import type { RuntimeId } from '@shared/runtime-registry';

export type WorkspaceMaasAccountPresentation = {
  platformId: NonNullable<MaasGlobalBindingStatus['platformId']>;
  providerName: string;
  endpoint: string | null;
  envKey: string | null;
};

export function getWorkspaceMaasAccountPresentation(
  binding: MaasGlobalBindingStatus | null | undefined,
  connections: readonly MaasConnection[] | undefined,
  runtimeId: RuntimeId | null
): WorkspaceMaasAccountPresentation | null {
  if (
    !runtimeId ||
    !binding?.enabled ||
    !binding.effective ||
    !binding.platformId ||
    !binding.runtimeIds.includes(runtimeId)
  ) {
    return null;
  }

  const connection = connections?.find((item) => item.platformId === binding.platformId);
  const providerName =
    connection?.displayName ?? getMaasPlatformDefinition(binding.platformId).name;

  return {
    platformId: binding.platformId,
    providerName,
    endpoint: connection?.endpoint ?? null,
    envKey: connection
      ? resolveMaasEnvKey(connection.platformId, connection.displayName, connection.envKey)
      : null,
  };
}
