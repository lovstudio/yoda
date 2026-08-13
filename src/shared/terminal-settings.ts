export const DEFAULT_TERMINAL_SCROLLBACK_LINES = 50_000;
export const MIN_TERMINAL_SCROLLBACK_LINES = 1_000;
export const MAX_TERMINAL_SCROLLBACK_LINES = 500_000;
export const TERMINAL_CACHE_MODES = ['auto', 'fixed'] as const;
export type TerminalCacheMode = (typeof TERMINAL_CACHE_MODES)[number];
/** Auto keeps every frontend terminal until runtime pressure is observed. */
export const DEFAULT_TERMINAL_CACHE_MODE: TerminalCacheMode = 'auto';
/** Used only when the user explicitly selects the fixed cache policy. */
export const DEFAULT_HOT_TERMINAL_LIMIT = 4;
export const MIN_HOT_TERMINAL_LIMIT = 1;
export const MAX_HOT_TERMINAL_LIMIT = 64;
export const DEFAULT_IDLE_SESSION_TIMEOUT_MINUTES = 5;
export const MAX_IDLE_SESSION_TIMEOUT_MINUTES = 120;

const RING_BUFFER_BYTES_PER_LINE = 128;
const MIN_TERMINAL_RING_BUFFER_BYTES = 1024 * 1024;

export function normalizeTerminalScrollbackLines(value: unknown): number {
  const numeric =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim()
        ? Number(value)
        : Number.NaN;

  if (!Number.isFinite(numeric)) return DEFAULT_TERMINAL_SCROLLBACK_LINES;

  return Math.min(
    MAX_TERMINAL_SCROLLBACK_LINES,
    Math.max(MIN_TERMINAL_SCROLLBACK_LINES, Math.floor(numeric))
  );
}

export function getTerminalRingBufferCapBytes(scrollbackLines: unknown): number {
  return Math.max(
    MIN_TERMINAL_RING_BUFFER_BYTES,
    normalizeTerminalScrollbackLines(scrollbackLines) * RING_BUFFER_BYTES_PER_LINE
  );
}
