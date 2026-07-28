import { describe, expect, it } from 'vitest';
import { resolveTerminalRendererEngine } from './terminal-renderer-selection';

describe('resolveTerminalRendererEngine', () => {
  it('prefers WebGL acceleration in automatic mode', () => {
    expect(resolveTerminalRendererEngine('auto')).toBe('webgl');
  });

  it('honors explicit renderer choices', () => {
    expect(resolveTerminalRendererEngine('webgl')).toBe('webgl');
    expect(resolveTerminalRendererEngine('dom')).toBe('dom');
  });
});
