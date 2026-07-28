import type { TerminalRenderer } from '@shared/terminal-settings';

export type TerminalRendererEngine = 'webgl' | 'dom';

/**
 * Choose the concrete xterm renderer for the user's preference.
 *
 * Automatic mode prefers the accelerated WebGL renderer on every platform.
 * FrontendPty falls back to DOM when WebGL cannot load or loses its context;
 * users can still explicitly select DOM when diagnosing a driver-specific
 * visual issue.
 */
export function resolveTerminalRendererEngine(
  preference: TerminalRenderer
): TerminalRendererEngine {
  return preference === 'dom' ? 'dom' : 'webgl';
}
