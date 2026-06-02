import { describe, expect, it } from 'vitest';
import { getDefaultForKey } from './settings-registry';

describe('settings defaults', () => {
  it('does not enable tmux by default', () => {
    expect(getDefaultForKey('project').tmuxByDefault).toBe(false);
  });
});
