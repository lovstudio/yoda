/**
 * Content sources the session status bar (the strip below the terminal) can
 * show. Single-select: the bar renders exactly one source at a time and the
 * user cycles between them. Stored globally in task settings as
 * `statusBarSource`.
 */
export const SESSION_STATUS_BAR_SOURCE_IDS = ['summary', 'recentPrompt', 'off'] as const;

export type SessionStatusBarSource = (typeof SESSION_STATUS_BAR_SOURCE_IDS)[number];

export const DEFAULT_SESSION_STATUS_BAR_SOURCE: SessionStatusBarSource = 'recentPrompt';
