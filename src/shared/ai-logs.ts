/** How the AI work was invoked: spawned CLI, direct HTTP API, or interactive PTY session. */
export const AI_LOG_MODES = ['cli', 'api', 'interactive'] as const;
export type AiLogMode = (typeof AI_LOG_MODES)[number];

export const AI_LOG_STATUSES = ['running', 'succeeded', 'failed'] as const;
export type AiLogStatus = (typeof AI_LOG_STATUSES)[number];

/**
 * Well-known purposes; the field is an open string so new call sites don't
 * need a shared-type change, but the UI has labels for these.
 */
export const AI_LOG_KNOWN_PURPOSES = [
  'task-naming',
  'session-title',
  'session-summary',
  'commit-message',
  'logo-generation',
  'app-image-edit',
  'maas-chat',
  'llm-debug',
  'interactive-session',
  'utility',
] as const;

export type AiInvocationLogRecord = {
  id: string;
  purpose: string;
  mode: AiLogMode;
  runtime: string;
  model: string | null;
  /** CLI command line or API endpoint, for replaying/debugging. */
  command: string | null;
  /** The prompt / request payload (clipped). */
  prompt: string | null;
  /** Final answer or stdout tail (clipped). */
  output: string | null;
  status: AiLogStatus;
  error: string | null;
  metadata: Record<string, string> | null;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
};

export type AiLogListInput = {
  status?: AiLogStatus;
  mode?: AiLogMode;
  runtime?: string;
  conversationId?: string;
  authProvider?: string;
  maasPlatformId?: string;
  limit?: number;
};
