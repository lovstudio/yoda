import { describe, expect, it } from 'vitest';
import { promptInvokesSkill } from './quick-action-source';

describe('promptInvokesSkill', () => {
  it('recognizes explicit Codex and Claude skill commands', () => {
    expect(promptInvokesSkill('$release-via-cicd')).toBe(true);
    expect(promptInvokesSkill('Use /review-code for this change')).toBe(true);
  });

  it('does not classify paths or ordinary prompts as skill invocations', () => {
    expect(promptInvokesSkill('Review src/app.ts')).toBe(false);
    expect(promptInvokesSkill('Open /Users/mark/project')).toBe(false);
  });
});
