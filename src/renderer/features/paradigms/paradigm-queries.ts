import type { QueryClient } from '@tanstack/react-query';

/**
 * The paradigm instance list — the one source every surface reads.
 *
 * A multi-agent team is a `team`-kind row here rather than a collection of its
 * own, so the composer, the picker, and a kind's configuration panel all
 * invalidate through this single key.
 */
export const paradigmsQueryKey = ['paradigms'] as const;

export function invalidateParadigmQueries(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({ queryKey: paradigmsQueryKey });
}
