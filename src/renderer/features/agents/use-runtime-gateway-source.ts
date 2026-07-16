import { useCallback, useMemo } from 'react';
import {
  hasMaasInferenceCredential,
  supportsMaasPlatformForRuntime,
  type MaasPlatformId,
} from '@shared/maas';
import type { AgentAccountProviderId, RuntimeId } from '@shared/runtime-registry';
import {
  useMaasConnections,
  useMaasGlobalBinding,
  useSetMaasGlobalBinding,
} from '@renderer/features/maas/useMaas';
import { useRuntimeSettings } from '@renderer/features/settings/use-runtime-settings';

type SelectionCallbacks = {
  onSuccess?: () => void;
  onError?: (error: Error) => void;
};

export function useRuntimeGatewaySource(runtimeId: RuntimeId) {
  const {
    value: providerConfig,
    isLoading: providerSettingsLoading,
    isSaving: providerSettingsSaving,
    update: updateProviderSettings,
  } = useRuntimeSettings(runtimeId);
  const maasConnections = useMaasConnections();
  const globalBinding = useMaasGlobalBinding();
  const setMaasGlobalBinding = useSetMaasGlobalBinding();

  const connectedMaasConnections = useMemo(
    () =>
      maasConnections.data?.filter(
        (connection) =>
          connection.connected &&
          hasMaasInferenceCredential(connection) &&
          supportsMaasPlatformForRuntime(runtimeId, connection.platformId)
      ) ?? [],
    [maasConnections.data, runtimeId]
  );
  const selectedMaasConnection =
    connectedMaasConnections.find(
      (connection) => connection.platformId === providerConfig?.maasPlatformId
    ) ?? connectedMaasConnections[0];

  const selectAuthProvider = useCallback(
    (
      authProvider: AgentAccountProviderId,
      maasPlatformId?: MaasPlatformId,
      callbacks: SelectionCallbacks = {}
    ) => {
      if (authProvider === 'yoda-maas') {
        const platformId = maasPlatformId ?? selectedMaasConnection?.platformId;
        if (!platformId) {
          callbacks.onError?.(new Error('No compatible MaaS platform is connected.'));
          return;
        }
        setMaasGlobalBinding.mutate(
          { platformId, enabled: true },
          {
            onSuccess: callbacks.onSuccess,
            onError: (error) =>
              callbacks.onError?.(error instanceof Error ? error : new Error(String(error))),
          }
        );
        return;
      }

      const updateAuthProvider = () => {
        const nextConfig = { ...(providerConfig ?? {}), authProvider };
        delete nextConfig.maasPlatformId;
        updateProviderSettings(nextConfig, {
          onSuccess: callbacks.onSuccess,
          onError: callbacks.onError,
        });
      };
      if (globalBinding.data?.enabled && globalBinding.data.platformId) {
        setMaasGlobalBinding.mutate(
          {
            platformId: globalBinding.data.platformId,
            enabled: false,
          },
          {
            onSuccess: updateAuthProvider,
            onError: (error) =>
              callbacks.onError?.(error instanceof Error ? error : new Error(String(error))),
          }
        );
        return;
      }
      updateAuthProvider();
    },
    [
      providerConfig,
      globalBinding.data,
      selectedMaasConnection?.platformId,
      setMaasGlobalBinding,
      updateProviderSettings,
    ]
  );

  return {
    providerConfig,
    providerSettingsLoading,
    providerSettingsSaving,
    updateProviderSettings,
    maasConnections,
    connectedMaasConnections,
    selectedMaasConnection,
    selectAuthProvider,
    isSaving: providerSettingsSaving || setMaasGlobalBinding.isPending,
  };
}
