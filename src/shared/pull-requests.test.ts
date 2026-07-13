import { describe, expect, it } from 'vitest';
import {
  formatPullRequestAsPrompt,
  formatPullRequestReviewPrompt,
  type PullRequest,
} from './pull-requests';

function createPullRequest(overrides: Partial<PullRequest> = {}): PullRequest {
  return {
    url: 'https://github.com/lovstudio/yoda/pull/42',
    provider: 'github',
    repositoryUrl: 'https://github.com/lovstudio/yoda',
    baseRefName: 'main',
    baseRefOid: 'base-sha',
    headRepositoryUrl: 'https://github.com/lovstudio/yoda',
    headRefName: 'feature/pr-review',
    headRefOid: 'head-sha',
    identifier: '#42',
    title: 'Add integrated PR review',
    description: 'Adds in-product PR review workflows.',
    status: 'open',
    isDraft: false,
    additions: 120,
    deletions: 8,
    changedFiles: 5,
    commitCount: 3,
    mergeableStatus: 'MERGEABLE',
    mergeStateStatus: 'CLEAN',
    reviewDecision: null,
    createdAt: '2026-07-04T01:00:00.000Z',
    updatedAt: '2026-07-04T02:00:00.000Z',
    author: null,
    labels: [],
    assignees: [],
    checks: [],
    ...overrides,
  };
}

describe('PullRequest', () => {
  it('formats pull request context into an agent prompt', () => {
    const pr = createPullRequest();

    expect(formatPullRequestAsPrompt(pr, 'Review this PR.')).toBe(
      [
        '[#42] Add integrated PR review',
        'https://github.com/lovstudio/yoda/pull/42',
        'Branch: feature/pr-review -> main',
        'Changed files: 5',
        'Diff: +120/-8',
        'Adds in-product PR review workflows.',
        '',
        'Review this PR.',
      ].join('\n')
    );
  });

  it('formats a pull request review prompt with default review guidance', () => {
    const pr = createPullRequest({ description: null });

    const prompt = formatPullRequestReviewPrompt(pr);

    expect(prompt).toContain('[#42] Add integrated PR review');
    expect(prompt).toContain('https://github.com/lovstudio/yoda/pull/42');
    expect(prompt).toContain('Review the linked pull request.');
    expect(prompt).toContain('Do not merge the pull request unless explicitly asked.');
    expect(prompt).toContain('checks were run');
  });
});
