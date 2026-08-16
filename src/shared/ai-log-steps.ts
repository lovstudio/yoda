/**
 * The inside of one AI invocation: the individual API requests, thinking
 * blocks, tool calls and results that ran between a prompt and its answer.
 *
 * The invocation log itself only knows the outer boundaries (what was asked,
 * what came back, how long it took). The per-request detail lives in the
 * provider's own transcript — see ADR 0009 — so a trace is read on demand
 * rather than mirrored into the database.
 */

export const AI_LOG_STEP_KINDS = [
  'prompt',
  'thinking',
  'text',
  'tool-use',
  'tool-result',
  'compact',
] as const;
export type AiLogStepKind = (typeof AI_LOG_STEP_KINDS)[number];

/** Tokens billed for one API request. `input` excludes the cached share. */
export type AiLogStepTokens = {
  input: number;
  cached: number;
  output: number;
};

export type AiLogStep = {
  index: number;
  kind: AiLogStepKind;
  /** Transcript timestamp, ISO. */
  at: string | null;
  /** Tool name, or the role that produced the step. */
  label: string | null;
  model: string | null;
  detail: string | null;
  /** Characters dropped from `detail` — a step is a preview, not the payload. */
  clippedChars: number;
  /** Present on the step that opened an API response; null elsewhere. */
  tokens: AiLogStepTokens | null;
  /** Gap since the previous step, ms. */
  sinceMs: number | null;
  isError: boolean;
  /** A subagent side thread rather than the main conversation. */
  sidechain: boolean;
};

/**
 * Why there is nothing to show. Every case is a fact about the data, never a
 * guess — an unreadable trace says so instead of rendering an empty timeline.
 */
export type AiLogTraceUnavailableReason =
  | 'unsupported-runtime'
  | 'no-conversation'
  | 'no-transcript'
  | 'empty-window';

export type AiLogTrace = {
  logId: string;
  steps: AiLogStep[];
  /** Steps in the window before the display cap; may exceed `steps.length`. */
  totalSteps: number;
  tokens: AiLogStepTokens;
  /** API responses observed in the window. */
  requestCount: number;
  transcriptPath: string | null;
  unavailable: AiLogTraceUnavailableReason | null;
};

export function emptyAiLogTokens(): AiLogStepTokens {
  return { input: 0, cached: 0, output: 0 };
}

export function sumAiLogTokens(steps: AiLogStep[]): AiLogStepTokens {
  const total = emptyAiLogTokens();
  for (const step of steps) {
    if (!step.tokens) continue;
    total.input += step.tokens.input;
    total.cached += step.tokens.cached;
    total.output += step.tokens.output;
  }
  return total;
}
