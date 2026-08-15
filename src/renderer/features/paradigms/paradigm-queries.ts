import type { QueryClient } from '@tanstack/react-query';

/**
 * Query keys for the paradigm instance list, and for the Agent Team view of it.
 *
 * Teams are `team`-kind paradigm rows read through an adapter, so the two lists
 * are the same data under two vocabularies: renaming a paradigm renames a team.
 * Both keys therefore invalidate together — from either side.
 */
export const paradigmsQueryKey = ['paradigms'] as const;
export const agentTeamsQueryKey = ['agentTeams'] as const;

export function invalidateParadigmQueries(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({ queryKey: paradigmsQueryKey });
  void queryClient.invalidateQueries({ queryKey: agentTeamsQueryKey });
}
