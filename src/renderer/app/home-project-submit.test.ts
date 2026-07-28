import { describe, expect, it } from 'vitest';
import { resolveProjectSubmitSourceBranch } from './home-project-submit';

describe('resolveProjectSubmitSourceBranch', () => {
  it('lets an imported non-git folder run an in-place task at the project root', () => {
    expect(
      resolveProjectSubmitSourceBranch({
        defaultBranch: undefined,
        currentBranch: null,
        isUnborn: true,
        strategyKind: 'no-worktree',
        baseRef: 'main',
      })
    ).toEqual({ type: 'local', branch: 'main' });
  });

  it('still requires a real branch before creating a worktree', () => {
    expect(
      resolveProjectSubmitSourceBranch({
        defaultBranch: undefined,
        currentBranch: null,
        isUnborn: true,
        strategyKind: 'new-branch',
        baseRef: 'main',
      })
    ).toBeUndefined();
  });

  it('uses a freshly discovered current branch while repository state catches up', () => {
    expect(
      resolveProjectSubmitSourceBranch({
        defaultBranch: undefined,
        currentBranch: 'trunk',
        isUnborn: false,
        strategyKind: 'new-branch',
        baseRef: 'main',
      })
    ).toEqual({ type: 'local', branch: 'trunk' });
  });
});
