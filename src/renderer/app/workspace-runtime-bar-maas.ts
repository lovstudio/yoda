import {
  getMaasPlatformDefinition,
  type MaasConnection,
  type MaasGlobalBindingStatus,
} from '@shared/maas';

export type WorkspaceMaasPresentation = {
  active: boolean;
  providerName: string | null;
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
