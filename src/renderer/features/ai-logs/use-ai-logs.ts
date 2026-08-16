import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import type { AiLogListInput } from '@shared/ai-logs';
import { aiLogUpdatedChannel } from '@shared/events/appEvents';
import { events, rpc } from '@renderer/lib/ipc';

export const aiLogsQueryKey = ['aiLogs'] as const;

export function useAiLogs(input: AiLogListInput, enabled = true) {
  const queryClient = useQueryClient();

  // Live updates: any inserted/updated log row invalidates the list, so
  // running invocations appear the moment they start.
  useEffect(() => {
    return events.on(aiLogUpdatedChannel, () => {
      void queryClient.invalidateQueries({ queryKey: aiLogsQueryKey });
    });
  }, [queryClient]);

  return useQuery({
    queryKey: [
      ...aiLogsQueryKey,
      input.status ?? 'all',
      input.mode ?? 'all',
      input.runtime ?? 'all',
      input.conversationId ?? 'all',
      input.authProvider ?? 'all',
      input.maasPlatformId ?? 'all',
      input.limit ?? 'default',
    ],
    queryFn: () => rpc.aiLogs.list(input),
    enabled,
  });
}

export function useClearAiLogs() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => rpc.aiLogs.clear(),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: aiLogsQueryKey });
    },
  });
}

/**
 * What ran inside one invocation, parsed from the provider transcript. Read on
 * demand — only when a row is expanded — because it means walking a JSONL file
 * that can be tens of megabytes. A still-running invocation is re-read on an
 * interval, since the transcript grows without emitting any app event.
 */
export function useAiLogTrace(logId: string, options: { live: boolean; enabled: boolean }) {
  return useQuery({
    queryKey: ['aiLogTrace', logId],
    queryFn: () => rpc.aiLogs.getTrace(logId),
    enabled: options.enabled,
    refetchInterval: options.live ? 4_000 : false,
  });
}
