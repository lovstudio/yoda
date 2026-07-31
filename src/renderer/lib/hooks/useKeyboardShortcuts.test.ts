import { describe, expect, it } from 'vitest';
import { getEffectiveHotkey } from './useKeyboardShortcuts';

describe('app keyboard shortcuts', () => {
  it('uses Mod+K as the default task search shortcut', () => {
    expect(getEffectiveHotkey('commandPaletteTasks')).toBe('Mod+K');
  });

  it('preserves a custom task search shortcut', () => {
    expect(getEffectiveHotkey('commandPaletteTasks', { commandPaletteTasks: 'Mod+Shift+K' })).toBe(
      'Mod+Shift+K'
    );
  });
});
