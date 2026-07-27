import type { Branch } from '@shared/git';

export type HomeProjectSubmitStrategy = 'new-branch' | 'no-worktree' | 'checkout-existing';

/**
 * Resolves the task's source-branch metadata without requiring a real Git ref
 * for in-place tasks. LovCode can register an ordinary folder as a project; in
 * that case Yoda still runs the task at the project root and uses `baseRef`
 * only as task metadata.
 */
export function resolveProjectSubmitSourceBranch({
  defaultBranch,
  currentBranch,
  isUnborn,
  strategyKind,
  baseRef,
}: {
  defaultBranch?: Branch;
  currentBranch: string | null;
  isUnborn: boolean;
  strategyKind: HomeProjectSubmitStrategy;
  baseRef: string;
}): Branch | undefined {
  if (defaultBranch) return defaultBranch;
  if (currentBranch) return { type: 'local', branch: currentBranch };
  if (isUnborn && strategyKind === 'no-worktree') {
    return { type: 'local', branch: baseRef || 'main' };
  }
  return undefined;
}
