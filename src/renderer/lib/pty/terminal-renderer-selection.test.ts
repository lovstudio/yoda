import { describe, expect, it } from 'vitest';
import {
  nextTerminalRendererPreference,
  resolveTerminalRendererDisplayMode,
  resolveTerminalRendererEngine,
} from './terminal-renderer-selection';

describe('resolveTerminalRendererEngine', () => {
  it('prefers WebGL acceleration in automatic mode', () => {
    expect(resolveTerminalRendererEngine('auto')).toBe('webgl');
  });

  it('honors explicit renderer choices', () => {
    expect(resolveTerminalRendererEngine('webgl')).toBe('webgl');
    expect(resolveTerminalRendererEngine('dom')).toBe('dom');
  });
});

describe('terminal renderer status toggle', () => {
  it('shows the renderer actually used by live terminals', () => {
    expect(
      resolveTerminalRendererDisplayMode('webgl', {
        activeCount: 2,
        webglCount: 0,
        domCount: 2,
      })
    ).toBe('dom');
    expect(
      resolveTerminalRendererDisplayMode('auto', {
        activeCount: 2,
        webglCount: 1,
        domCount: 1,
      })
    ).toBe('mixed');
  });

  it('uses the configured mode when no terminal is active', () => {
    expect(
      resolveTerminalRendererDisplayMode('auto', {
        activeCount: 0,
        webglCount: 0,
        domCount: 0,
      })
    ).toBe('webgl');
  });

  it('toggles between WebGL and DOM and resolves mixed mode to WebGL', () => {
    expect(nextTerminalRendererPreference('webgl')).toBe('dom');
    expect(nextTerminalRendererPreference('dom')).toBe('webgl');
    expect(nextTerminalRendererPreference('mixed')).toBe('webgl');
  });
});
