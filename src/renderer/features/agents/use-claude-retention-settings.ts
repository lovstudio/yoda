import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ClaudeRetentionSettings } from '@shared/claude-retention';
import { rpc } from '@renderer/lib/ipc';

export const CLAUDE_RETENTION_QUERY_KEY = ['runtimeSettings', 'claude', 'retention'] as const;

export function useClaudeRetentionSettings() {
  const queryClient = useQueryClient();
  const query = useQuery<ClaudeRetentionSettings>({
    queryKey: CLAUDE_RETENTION_QUERY_KEY,
    queryFn: () => rpc.runtimeSettings.getClaudeRetentionSettings(),
    staleTime: 60_000,
  });
  const mutation = useMutation<ClaudeRetentionSettings, Error, number>({
    mutationFn: (cleanupPeriodDays) =>
      rpc.runtimeSettings.updateClaudeRetentionSettings(cleanupPeriodDays),
    onSuccess: (value) => {
      queryClient.setQueryData(CLAUDE_RETENTION_QUERY_KEY, value);
    },
  });

  return {
    ...query,
    save: mutation.mutateAsync,
    isSaving: mutation.isPending,
    saveError: mutation.error,
    resetSaveError: mutation.reset,
  };
}
