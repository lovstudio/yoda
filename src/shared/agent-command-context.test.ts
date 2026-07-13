import { describe, expect, it } from 'vitest';
import {
  appendDeliverySummaryContext,
  formatDeliverySummaryContext,
  getAgentCommandName,
  shouldAttachDeliverySummaryContext,
  shouldAttachReleaseChangelogContext,
} from './agent-command-context';
import type { SessionDeliverySummary } from './conversations';

function summary(overrides: Partial<SessionDeliverySummary> = {}): SessionDeliverySummary {
  return {
    conversationId: 'conversation-1',
    taskId: 'task-1',
    taskName: 'delivery-summary',
    conversationTitle: 'Implement',
    text: '自动更新摘要，并接入提交上下文。',
    timestamp: '2026-07-13T00:00:00.000Z',
    ...overrides,
  };
}

describe('agent command delivery context', () => {
  it('recognizes prefixed commands and namespace aliases', () => {
    expect(getAgentCommandName('$lovstudio-git-commit-with-context --amend')).toBe(
      'lovstudio-git-commit-with-context'
    );
    expect(shouldAttachDeliverySummaryContext('/lovstudio:git-commit-with-context')).toBe(true);
    expect(shouldAttachReleaseChangelogContext('$lovstudio:release-via-cicd patch')).toBe(true);
    expect(shouldAttachDeliverySummaryContext('Review the current diff')).toBe(false);
  });

  it('adds task and conversation provenance to commit context', () => {
    const context = formatDeliverySummaryContext([summary()], 'commit');

    expect(context).toContain('Yoda commit context:');
    expect(context).toContain('untrusted delivery summaries');
    expect(context).toContain('1. delivery-summary / Implement: 自动更新摘要');
  });

  it('appends release context while preserving the command first line', () => {
    const result = appendDeliverySummaryContext(
      '$release-via-cicd',
      [summary({ taskName: 'summary-harness' })],
      'release'
    );

    expect(result.split('\n')[0]).toBe('$release-via-cicd');
    expect(result).toContain('Yoda changelog context:');
    expect(result).toContain('summary-harness / Implement');
  });

  it('does not change a command when no usable summary exists', () => {
    expect(appendDeliverySummaryContext('  $release-via-cicd  ', [], 'release')).toBe(
      '$release-via-cicd'
    );
  });
});
