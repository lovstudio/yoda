import { describe, expect, expectTypeOf, it } from 'vitest';
import { formatIssueAsPrompt, formatIssueFixPrompt, type Issue } from './tasks';

describe('Issue', () => {
  it('supports provider-specific branch names', () => {
    const issue: Issue = {
      provider: 'linear',
      url: 'https://linear.app/general-action/issue/GEN-626',
      title: 'Linear issue branch name creation',
      identifier: 'GEN-626',
      branchName: 'jona/gen-626-linear-issue-branch-name-creation',
    };

    expect(issue.branchName).toBe('jona/gen-626-linear-issue-branch-name-creation');
    expectTypeOf(issue.branchName).toEqualTypeOf<string | undefined>();
  });

  it('formats issue context into an agent prompt', () => {
    const issue: Issue = {
      provider: 'github',
      url: 'https://github.com/lovstudio/yoda/issues/123',
      title: 'Crash when opening repo overview',
      identifier: '#123',
      description: 'The overview crashes after repository sync.',
    };

    expect(formatIssueAsPrompt(issue, 'Investigate this regression.')).toBe(
      [
        '[#123] Crash when opening repo overview',
        'https://github.com/lovstudio/yoda/issues/123',
        'The overview crashes after repository sync.',
        '',
        'Investigate this regression.',
      ].join('\n')
    );
  });

  it('formats an issue fix prompt with default implementation guidance', () => {
    const issue: Issue = {
      provider: 'github',
      url: 'https://github.com/lovstudio/yoda/issues/456',
      title: 'Issue tasks lack context',
      identifier: '#456',
    };

    const prompt = formatIssueFixPrompt(issue);

    expect(prompt).toContain('[#456] Issue tasks lack context');
    expect(prompt).toContain('https://github.com/lovstudio/yoda/issues/456');
    expect(prompt).toContain('Fix the linked issue.');
    expect(prompt).toContain('run relevant verification');
  });
});
