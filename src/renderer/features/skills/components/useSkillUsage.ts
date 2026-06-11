import { useQuery } from '@tanstack/react-query';
import { useCallback } from 'react';
import type { SkillUsageStat } from '@shared/skills/types';
import { rpc } from '@renderer/lib/ipc';

const USAGE_QUERY_KEY = ['skills', 'usage'] as const;

/**
 * Real invocation stats parsed from local Claude Code / Codex data via the
 * skillusage CLI. Unavailable (null) when the CLI is not installed.
 */
export function useSkillUsage() {
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

  const lookupUsage = useCallback(
    (skillId: string): SkillUsageStat | undefined => data?.bySkill[skillId.toLowerCase()],
    [data]
  );

  return { usage: data, lookupUsage };
}
