import { describe, expect, it } from 'vitest';
import { DEFAULT_TERMINAL_RENDERER, normalizeTerminalRenderer } from './terminal-settings';

describe('terminal settings', () => {
  it('normalizes terminal renderer preferences', () => {
    expect(normalizeTerminalRenderer('webgl')).toBe('webgl');
    expect(normalizeTerminalRenderer('DOM')).toBe('dom');
    expect(normalizeTerminalRenderer(' auto ')).toBe('auto');
  });

  it('falls back to the default renderer for invalid preferences', () => {
    expect(normalizeTerminalRenderer('canvas')).toBe(DEFAULT_TERMINAL_RENDERER);
    expect(normalizeTerminalRenderer(null)).toBe(DEFAULT_TERMINAL_RENDERER);
  });
});
