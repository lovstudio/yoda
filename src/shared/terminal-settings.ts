export const DEFAULT_TERMINAL_SCROLLBACK_LINES = 200_000;
export const MIN_TERMINAL_SCROLLBACK_LINES = 1_000;
export const MAX_TERMINAL_SCROLLBACK_LINES = 500_000;
export const TERMINAL_RENDERERS = ['auto', 'webgl', 'dom'] as const;
export type TerminalRenderer = (typeof TERMINAL_RENDERERS)[number];
export const DEFAULT_TERMINAL_RENDERER: TerminalRenderer = 'auto';

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

export function normalizeTerminalRenderer(value: unknown): TerminalRenderer {
  if (typeof value !== 'string') return DEFAULT_TERMINAL_RENDERER;
  const normalized = value.trim().toLowerCase();
  return TERMINAL_RENDERERS.includes(normalized as TerminalRenderer)
    ? (normalized as TerminalRenderer)
    : DEFAULT_TERMINAL_RENDERER;
}

export function getTerminalRingBufferCapBytes(scrollbackLines: unknown): number {
  return Math.max(
    MIN_TERMINAL_RING_BUFFER_BYTES,
    normalizeTerminalScrollbackLines(scrollbackLines) * RING_BUFFER_BYTES_PER_LINE
  );
}
