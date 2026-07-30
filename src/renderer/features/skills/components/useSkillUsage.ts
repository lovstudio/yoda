import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { SkillUsageStat } from '@shared/skills/types';
import { rpc } from '@renderer/lib/ipc';
import { log } from '@renderer/utils/logger';

const USAGE_QUERY_KEY = ['skills', 'usage'] as const;
const BACKGROUND_REFRESH_MS = 60_000;

/**
 * Real invocation stats parsed from local Claude Code / Codex data via the
 * skillusage CLI. Unavailable (null) when the CLI is not installed.
 */
export function useSkillUsage() {
  const queryClient = useQueryClient();
  const refreshPromiseRef = useRef<Promise<boolean> | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const { data = null } = useQuery({
    queryKey: USAGE_QUERY_KEY,
    queryFn: async () => {
      const result = await rpc.skills.getUsageStats();
      if (result.success && result.data) return result.data;
      throw new Error(result.error ?? 'Failed to load skill usage stats');
    },
    staleTime: 5 * 60_000,
    retry: false,
  });

  const refresh = useCallback((): Promise<boolean> => {
    if (refreshPromiseRef.current) return refreshPromiseRef.current;

    setIsRefreshing(true);
    const refreshPromise = (async () => {
      try {
        const result = await rpc.skills.getUsageStats({ refresh: true });
        if (!result.success || !result.data) {
          throw new Error(result.error ?? 'Failed to refresh skill usage stats');
        }
        queryClient.setQueryData(USAGE_QUERY_KEY, result.data);
        return true;
      } catch (error) {
        log.error('Failed to refresh skill usage stats:', error);
        return false;
      } finally {
        refreshPromiseRef.current = null;
        setIsRefreshing(false);
      }
    })();
    refreshPromiseRef.current = refreshPromise;
    return refreshPromise;
  }, [queryClient]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!data) return;
    const interval = window.setInterval(() => void refresh(), BACKGROUND_REFRESH_MS);
    return () => window.clearInterval(interval);
  }, [data, refresh]);

  const lookupUsage = useCallback(
    (skillId: string): SkillUsageStat | undefined => data?.bySkill[skillId.toLowerCase()],
    [data]
  );

  return { usage: data, isRefreshing, refresh, lookupUsage };
}
