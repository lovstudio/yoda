import { describe, expect, it } from 'vitest';
import { resolveTerminalRendererEngine } from './terminal-renderer-selection';

describe('resolveTerminalRendererEngine', () => {
  it.each(['MacIntel', 'macOS'])('uses the stable DOM renderer for auto mode on %s', (platform) => {
    expect(resolveTerminalRendererEngine('auto', platform)).toBe('dom');
  });

  it.each(['Linux x86_64', 'Win32'])('keeps WebGL acceleration for auto mode on %s', (platform) => {
    expect(resolveTerminalRendererEngine('auto', platform)).toBe('webgl');
  });

  it('uses DOM when the runtime platform is unavailable', () => {
    expect(resolveTerminalRendererEngine('auto', '')).toBe('dom');
  });

  it('honors explicit renderer choices on macOS', () => {
    expect(resolveTerminalRendererEngine('webgl', 'MacIntel')).toBe('webgl');
    expect(resolveTerminalRendererEngine('dom', 'MacIntel')).toBe('dom');
  });
});
