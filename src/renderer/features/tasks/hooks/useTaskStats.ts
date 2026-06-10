import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { agentSessionExitedChannel } from '@shared/events/agentEvents';
import { events, rpc } from '@renderer/lib/ipc';

const taskStatsQueryKey = (projectId: string, taskId: string) =>
  ['task-stats', projectId, taskId] as const;

/**
 * Per-task stats (code delta + per-session token usage) from the stats RPC.
 * Refreshed when an agent session for this task exits — that's when the
 * transcript and diff snapshot move.
 */
export function useTaskStats(projectId: string, taskId: string, options?: { enabled?: boolean }) {
  const queryClient = useQueryClient();

  useEffect(() => {
    return events.on(agentSessionExitedChannel, (event) => {
      if (event.projectId !== projectId || event.taskId !== taskId) return;
      void queryClient.invalidateQueries({ queryKey: taskStatsQueryKey(projectId, taskId) });
    });
  }, [queryClient, projectId, taskId]);

  return useQuery({
    queryKey: taskStatsQueryKey(projectId, taskId),
    queryFn: () => rpc.stats.getTaskStats(projectId, taskId),
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    enabled: options?.enabled ?? true,
  });
}
