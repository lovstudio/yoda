import { describe, expect, it } from 'vitest';
import { getDefaultForKey } from './settings-registry';

describe('settings defaults', () => {
  it('enables tmux by default', () => {
    expect(getDefaultForKey('project').tmuxByDefault).toBe(true);
  });

  it('enables delivery summaries while leaving other language calls disabled', () => {
    const tasks = getDefaultForKey('tasks');
    expect(tasks.workspacesEnabled).toBe(false);
    expect(tasks.inputPromptLanguage).toBe('skip');
    expect(tasks.namingLanguage).toBe('skip');
    expect(tasks.summaryLanguage).toBe('app');
  });

  it('uses stable terminal defaults without exposing a renderer switch', () => {
    expect(getDefaultForKey('terminal')).toMatchObject({
      autoCopyOnSelection: true,
    });
    expect(getDefaultForKey('terminal')).not.toHaveProperty('renderer');
  });

  it('shows only final agent replies in the conversation panel by default', () => {
    expect(getDefaultForKey('interface').agentReplyDisplayLevel).toBe('concise');
  });
});
