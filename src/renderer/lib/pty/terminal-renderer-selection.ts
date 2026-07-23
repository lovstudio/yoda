import type { TerminalRenderer } from '@shared/terminal-settings';

export type TerminalRendererEngine = 'webgl' | 'dom';

/**
 * Choose the concrete xterm renderer for the user's preference.
 *
 * Chromium's WebGL canvas can retain partially repainted terminal glyphs on
 * macOS during long-running, cursor-addressed TUI updates. The underlying PTY
 * buffer remains correct, but the screen accumulates stale text until it is no
 * longer readable. Prefer xterm's stable DOM renderer for macOS automatic mode;
 * an explicit WebGL selection still opts into the accelerated renderer.
 */
export function resolveTerminalRendererEngine(
  preference: TerminalRenderer,
  platform: string
): TerminalRendererEngine {
  if (preference === 'webgl') return 'webgl';
  if (preference === 'dom') return 'dom';

  const normalizedPlatform = platform.trim().toLowerCase();
  if (!normalizedPlatform || normalizedPlatform.startsWith('mac')) return 'dom';
  return 'webgl';
}
