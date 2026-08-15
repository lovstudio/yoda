import type { SessionCompaction } from '@shared/conversations';

/**
 * Compaction boundaries that fall immediately before a 1-based prompt index.
 *
 * `afterPromptIndex` counts the prompts preceding the boundary, so the
 * boundaries shown above prompt N are those with `afterPromptIndex === N - 1`.
 * Consecutive compactions with no prompt between them share an index and are
 * all returned, so a surface can collapse them into one marker.
 */
export function compactionsBeforePrompt(
  compactions: readonly SessionCompaction[] | undefined,
  promptIndex: number
): SessionCompaction[] {
  if (!compactions?.length) return [];
  return compactions.filter((compaction) => compaction.afterPromptIndex === promptIndex - 1);
}

/**
 * Boundaries after the last prompt — a compaction the next prompt has not
 * followed yet. Surfaces render these below the list instead of above a row.
 */
export function trailingCompactions(
  compactions: readonly SessionCompaction[] | undefined,
  promptCount: number
): SessionCompaction[] {
  if (!compactions?.length) return [];
  return compactions.filter((compaction) => compaction.afterPromptIndex >= promptCount);
}

/** Total context the runtime dropped across a group of boundaries. */
export function droppedTokens(compactions: readonly SessionCompaction[]): number | null {
  let total = 0;
  let known = false;
  for (const compaction of compactions) {
    if (compaction.preTokens === null || compaction.postTokens === null) continue;
    known = true;
    total += Math.max(0, compaction.preTokens - compaction.postTokens);
  }
  return known ? total : null;
}
