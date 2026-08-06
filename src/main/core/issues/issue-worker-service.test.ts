import { describe, expect, it } from 'vitest';
import type { BranchesPayload } from '@shared/git';
import type { Issue } from '@shared/tasks';
import { resolveIssueWorkerSourceBranch, selectIssueWorkerCandidates } from './issue-worker-utils';

function issue(identifier: string, status = 'open'): Issue {
  return {
    provider: 'github',
    identifier,
    title: `Issue ${identifier}`,
    url: `https://github.com/lovstudio/yoda/issues/${identifier.slice(1)}`,
    status,
  };
}

function branches(overrides: Partial<BranchesPayload> = {}): BranchesPayload {
  return {
    branches: [],
    currentBranch: 'feature/current',
    isUnborn: false,
    gitDefaultBranch: 'main',
    remotes: [{ name: 'origin', url: 'https://github.com/lovstudio/yoda.git' }],
    ...overrides,
  };
}

describe('resolveIssueWorkerSourceBranch', () => {
  it('prefers a local default branch', () => {
    expect(
      resolveIssueWorkerSourceBranch(
        branches({
          branches: [
            {
              type: 'remote',
              branch: 'main',
              remote: { name: 'origin', url: 'https://github.com/lovstudio/yoda.git' },
            },
            { type: 'local', branch: 'main' },
          ],
        })
      )
    ).toEqual({ type: 'local', branch: 'main' });
  });

  it('uses the remote default before the current feature branch', () => {
    const remote = {
      type: 'remote' as const,
      branch: 'main',
      remote: { name: 'origin', url: 'https://github.com/lovstudio/yoda.git' },
    };
    expect(resolveIssueWorkerSourceBranch(branches({ branches: [remote] }))).toEqual(remote);
  });

  it('honors the project default-branch preference', () => {
    const remote = {
      type: 'remote' as const,
      branch: 'release',
      remote: { name: 'upstream', url: 'https://github.com/lovstudio/yoda.git' },
    };
    expect(
      resolveIssueWorkerSourceBranch(branches({ branches: [remote] }), 'upstream/release')
    ).toEqual(remote);
  });

  it('does not create worktree tasks in an unborn repository', () => {
    expect(resolveIssueWorkerSourceBranch(branches({ isUnborn: true }))).toBeNull();
  });
});

describe('selectIssueWorkerCandidates', () => {
  it('keeps provider order while excluding closed and already-linked issues', () => {
    const issues = [issue('#3'), issue('#2', 'closed'), issue('#1')];
    const linked = new Set([issues[0].url]);

    expect(selectIssueWorkerCandidates(issues, linked, 3)).toEqual([issues[2]]);
  });

  it('stops at the available capacity', () => {
    const issues = [issue('#3'), issue('#2'), issue('#1')];
    expect(selectIssueWorkerCandidates(issues, new Set(), 2)).toEqual(issues.slice(0, 2));
  });
});
