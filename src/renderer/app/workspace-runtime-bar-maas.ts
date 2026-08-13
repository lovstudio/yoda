import {
  getMaasPlatformDefinition,
  resolveMaasEnvKey,
  type MaasConnection,
  type MaasGlobalBindingStatus,
} from '@shared/maas';
import type { RuntimeId } from '@shared/runtime-registry';

export type WorkspaceMaasPresentation = {
  active: boolean;
  providerName: string | null;
};

export type WorkspaceMaasAccountPresentation = {
  platformId: NonNullable<MaasGlobalBindingStatus['platformId']>;
  providerName: string;
  endpoint: string | null;
  envKey: string | null;
};

export function getWorkspaceMaasPresentation(
  binding: MaasGlobalBindingStatus | null | undefined,
  connections: readonly MaasConnection[] | undefined
): WorkspaceMaasPresentation {
  if (!binding?.enabled || !binding.platformId) {
    return { active: false, providerName: null };
  }

  const selectedConnection = connections?.find(
    (connection) => connection.platformId === binding.platformId
  );

  return {
    active: true,
    providerName:
      selectedConnection?.displayName ?? getMaasPlatformDefinition(binding.platformId).name,
  };
}

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
