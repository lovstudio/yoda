import type { TerminalRenderer } from '@shared/terminal-settings';

export type TerminalRendererEngine = 'webgl' | 'dom';
export type TerminalRendererDisplayMode = TerminalRendererEngine | 'mixed';

export type TerminalRendererCounts = {
  activeCount: number;
  webglCount: number;
  domCount: number;
};

/**
 * Choose the concrete xterm renderer for the user's preference.
 *
 * Automatic mode follows the common xterm/VS Code policy: prefer accelerated
 * WebGL rendering, then let FrontendPty fall back to DOM if WebGL cannot load or
 * loses its context. Users can explicitly choose DOM when a live WebGL context
 * develops visual corruption without reporting a hard failure.
 */
export function resolveTerminalRendererEngine(
  preference: TerminalRenderer
): TerminalRendererEngine {
  if (preference === 'dom') return 'dom';
  return 'webgl';
}

/** Resolve the mode currently visible across live terminals for status UI. */
export function resolveTerminalRendererDisplayMode(
  preference: TerminalRenderer,
  counts: TerminalRendererCounts
): TerminalRendererDisplayMode {
  if (counts.activeCount > 0) {
    if (counts.webglCount > 0 && counts.domCount > 0) return 'mixed';
    if (counts.webglCount > 0) return 'webgl';
    if (counts.domCount > 0) return 'dom';
  }

  return resolveTerminalRendererEngine(preference);
}

/** Mixed mode converges back to WebGL; otherwise this behaves as a two-way toggle. */
export function nextTerminalRendererPreference(
  mode: TerminalRendererDisplayMode
): TerminalRenderer {
  return mode === 'webgl' ? 'dom' : 'webgl';
}
