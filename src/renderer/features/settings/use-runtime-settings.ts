import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { RuntimeCustomConfig } from '@shared/app-settings';
import { rpc } from '@renderer/lib/ipc';

type ProviderSettingsMeta = {
  value: RuntimeCustomConfig;
  defaults: RuntimeCustomConfig;
  overrides: Partial<RuntimeCustomConfig>;
} | null;

export function useRuntimeSettings(runtimeId: string) {
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery<ProviderSettingsMeta>({
    queryKey: ['runtimeSettings', runtimeId, 'meta'] as const,
    queryFn: () => rpc.runtimeSettings.getItemWithMeta(runtimeId) as Promise<ProviderSettingsMeta>,
    staleTime: 60_000,
  });

  const updateMutation = useMutation<void, Error, Partial<RuntimeCustomConfig>>({
    mutationFn: (config) => rpc.runtimeSettings.updateItem(runtimeId, config) as Promise<void>,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['runtimeSettings', runtimeId, 'meta'] });
      void queryClient.invalidateQueries({
        queryKey: ['runtimeSettings', runtimeId, 'runtimeAccountStatus'],
      });
      void queryClient.invalidateQueries({ queryKey: ['runtimeSettings', 'all'] });
      void queryClient.invalidateQueries({ queryKey: ['runtimeSnapshot', runtimeId] });
    },
  });

  const resetMutation = useMutation<void, Error, void>({
    mutationFn: () => rpc.runtimeSettings.resetItem(runtimeId) as Promise<void>,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['runtimeSettings', runtimeId, 'meta'] });
      void queryClient.invalidateQueries({
        queryKey: ['runtimeSettings', runtimeId, 'runtimeAccountStatus'],
      });
      void queryClient.invalidateQueries({ queryKey: ['runtimeSettings', 'all'] });
      void queryClient.invalidateQueries({ queryKey: ['runtimeSnapshot', runtimeId] });
    },
  });

  return {
    value: data?.value,
    defaults: data?.defaults,
    overrides: data?.overrides,
    isLoading,
    isSaving: updateMutation.isPending || resetMutation.isPending,
    isOverridden: !!(data?.overrides && Object.keys(data.overrides).length > 0),
    isFieldOverridden: (field: keyof RuntimeCustomConfig) =>
      !!(data?.overrides && field in data.overrides),
    update: updateMutation.mutate,
    reset: resetMutation.mutate,
  };
}
