import { describe, expect, it } from 'vitest';
import { getDefaultForKey } from './settings-registry';

describe('settings defaults', () => {
  it('enables tmux by default', () => {
    expect(getDefaultForKey('project').tmuxByDefault).toBe(true);
  });

  it('keeps naming and summaries on while prompt rewriting stays opt-in', () => {
    const tasks = getDefaultForKey('tasks');
    expect(tasks.workspacesEnabled).toBe(false);
    expect(tasks.autoGenerateName).toBe(true);
    expect(tasks.autoGenerateSummary).toBe(true);
    // No default: absent means "never set", which makes the switch fall back to
    // the legacy inference from `inputPromptLanguage` — 'skip' reads as off.
    expect(tasks.promptRewriteEnabled).toBeUndefined();
    expect(tasks.inputPromptLanguage).toBe('skip');
    expect(tasks.namingLanguage).toBe('app');
    expect(tasks.summaryLanguage).toBe('app');
  });

  it('uses stable terminal defaults without exposing a renderer switch', () => {
    expect(getDefaultForKey('terminal')).toMatchObject({
      autoCopyOnSelection: true,
      linkOpen: { file: 'yoda', url: 'yoda', fileRules: [] },
      hotTerminalMode: 'auto',
      hotTerminalLimit: 4,
    });
    expect(getDefaultForKey('terminal')).not.toHaveProperty('renderer');
  });

  it('shows only final agent replies in the conversation panel by default', () => {
    expect(getDefaultForKey('interface').agentReplyDisplayLevel).toBe('concise');
  });

  it('prioritizes product information in the sidebar status bar by default', () => {
    expect(getDefaultForKey('interface').sidebarStatusBarPrimary).toBe('product');
  });

  it('preserves the established task hierarchy in the default appearance preset', () => {
    expect(getDefaultForKey('interface').taskAppearance).toEqual({
      standard: {
        titleStyle: 'regular',
        idleOpacity: 100,
        marker: 'none',
      },
      longTerm: {
        titleStyle: 'italic',
        idleOpacity: 70,
        marker: 'none',
      },
      multiAgent: {
        marker: 'users',
      },
    });
  });
});
