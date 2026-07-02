import { describe, expect, it } from 'vitest';
import { getDefaultForKey } from './settings-registry';

describe('settings defaults', () => {
  it('enables tmux by default', () => {
    expect(getDefaultForKey('project').tmuxByDefault).toBe(true);
  });

  it('disables extra language generation calls by default', () => {
    const tasks = getDefaultForKey('tasks');
    expect(tasks.inputPromptLanguage).toBe('skip');
    expect(tasks.namingLanguage).toBe('skip');
    expect(tasks.summaryLanguage).toBe('skip');
  });

  it('uses automatic terminal renderer selection by default', () => {
    expect(getDefaultForKey('terminal').renderer).toBe('auto');
  });
});
