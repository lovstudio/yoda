import { describe, expect, it } from 'vitest';
import { getDefaultForKey } from './settings-registry';

describe('settings defaults', () => {
  it('enables tmux by default', () => {
    expect(getDefaultForKey('project').tmuxByDefault).toBe(true);
  });

  it('enables delivery summaries while leaving other language calls disabled', () => {
    const tasks = getDefaultForKey('tasks');
    expect(tasks.inputPromptLanguage).toBe('skip');
    expect(tasks.namingLanguage).toBe('skip');
    expect(tasks.summaryLanguage).toBe('app');
  });

  it('uses automatic terminal renderer selection by default', () => {
    expect(getDefaultForKey('terminal').renderer).toBe('auto');
  });
});
