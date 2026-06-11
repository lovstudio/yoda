/**
 * Content sources the session status bar (the strip below the terminal) can
 * show. Single-select: the bar renders exactly one source at a time and the
 * user cycles between them. Stored globally in task settings as
 * `statusBarSource`.
 */
export const SESSION_STATUS_BAR_SOURCE_IDS = ['summary', 'recentPrompt', 'off'] as const;

export type SessionStatusBarSource = (typeof SESSION_STATUS_BAR_SOURCE_IDS)[number];

export const DEFAULT_SESSION_STATUS_BAR_SOURCE: SessionStatusBarSource = 'recentPrompt';

/**
 * How many oldest / newest prompts the expanded prompt-history blind shows
 * (the middle is elided). The bar itself always shows the newest prompt, so
 * the tail count applies to the prompts just before it.
 */
export const DEFAULT_STATUS_BAR_PROMPT_HEAD = 1;
export const DEFAULT_STATUS_BAR_PROMPT_TAIL = 3;
export const STATUS_BAR_PROMPT_EDGE_MAX = 10;

export function clampStatusBarPromptEdge(value: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(STATUS_BAR_PROMPT_EDGE_MAX, Math.max(0, Math.round(value)));
}
