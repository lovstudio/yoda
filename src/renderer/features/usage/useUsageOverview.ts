import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import {
  agentSessionExitedChannel,
  agentSessionStatusChangedChannel,
  isAgentSessionRunningStatus,
} from '@shared/events/agentEvents';
import { events, rpc } from '@renderer/lib/ipc';

const USAGE_OVERVIEW_KEY = ['usage', 'overview'] as const;

/**
 * Lifetime usage rollup for the Usage view, or one project's slice when
 * `projectId` is given. The first fetch parses all historical transcripts in
 * the main process; afterwards the mtime cache makes refetches cheap, so
 * per-turn invalidation is affordable.
 */
export function useUsageOverview(projectId?: string) {
  const queryClient = useQueryClient();

  useEffect(() => {
    const invalidate = () => {
      // Prefix match — invalidates the global and every project-scoped query.
      void queryClient.invalidateQueries({ queryKey: USAGE_OVERVIEW_KEY });
    };
    const offExited = events.on(agentSessionExitedChannel, invalidate);
    // Long-lived sessions never exit while the user watches the card — also
    // refresh whenever a turn ends (status leaves working/awaiting-input),
    // which is when the transcript gains new usage entries.
    const offStatus = events.on(agentSessionStatusChangedChannel, ({ status }) => {
      if (!isAgentSessionRunningStatus(status)) invalidate();
    });
    return () => {
      offExited();
      offStatus();
    };
  }, [queryClient]);

  return useQuery({
    queryKey: [...USAGE_OVERVIEW_KEY, projectId ?? 'all'],
    queryFn: () => rpc.stats.getUsageOverview(projectId),
    staleTime: 60_000,
    refetchOnWindowFocus: true,
    // The full-history parse is expensive — surface failures instead of
    // silently re-running it through the default retry ladder.
    retry: 1,
  });
}
