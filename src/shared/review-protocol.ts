import { stripTerminalControlSequences, withSystemPrompt } from './prompt-format';

/** Maximum implement→review cycles before the orchestration gives up. */
export const REVIEW_MAX_ROUNDS = 3;

/**
 * The reviewer must end its turn with exactly one of these marker lines. The
 * marker doubles as the most reliable turn-end signal: provider run-state can
 * be missed (e.g. codex never writing `task_complete`), but the marker appears
 * in the PTY output regardless, so the orchestrator can advance on it alone.
 */
export const REVIEW_RESULT_MARKER = /YODA_REVIEW_RESULT:[ \t]*(PASS|FAIL)\b/gi;

export interface ReviewResult {
  /** True only when an explicit PASS marker is present. */
  passed: boolean;
  /** True when either marker (PASS or FAIL) is present in the output. */
  hasMarker: boolean;
  /** Trailing slice of the cleaned output, used as feedback for the implementer. */
  feedback: string;
}

export function parseReviewResult(output: string): ReviewResult {
  const clean = stripTerminalControlSequences(output).trim();
  // Take the LAST verdict: the reviewer is told to end its turn with the marker,
  // so a match earlier in the buffer is at best a restated format and at worst a
  // stale verdict. (The injected prompt uses a non-matching `<PASS|FAIL>`
  // placeholder so it can't be mistaken for a real verdict in the first place.)
  const last = [...clean.matchAll(REVIEW_RESULT_MARKER)].at(-1);
  return {
    passed: last?.[1]?.toUpperCase() === 'PASS',
    hasMarker: last !== undefined,
    feedback: clean.slice(-12_000),
  };
}

export function buildReviewPrompt(args: {
  requirement: string;
  round: number;
  systemPrompt: string;
}): string {
  return withSystemPrompt(
    args.systemPrompt,
    [
      `Original requirement:`,
      args.requirement || '(No explicit requirement was provided.)',
      '',
      `Round: ${args.round}`,
      '',
      `Protocol:`,
      `- Do not modify files.`,
      `- If there are issues, list concrete fixes for implementer agent A first.`,
      `- Then end your response with a single status line, written exactly in this`,
      `  format (replace <PASS|FAIL> with the literal word PASS or FAIL):`,
      `  YODA_REVIEW_RESULT: <PASS|FAIL>`,
      `  Use PASS only when the implementation fully meets the requirement;`,
      `  otherwise use FAIL.`,
    ].join('\n')
  );
}

export function buildImplementerFeedbackPrompt(args: {
  requirement: string;
  reviewFeedback: string;
}): string {
  return [
    `Reviewer agent B found issues in your implementation.`,
    '',
    `Original requirement:`,
    args.requirement || '(No explicit requirement was provided.)',
    '',
    `Review feedback:`,
    args.reviewFeedback,
    '',
    `Please address the issues in this same worktree. Keep the existing direction where possible, update tests if needed, and stop when the next implementation round is complete.`,
  ].join('\n');
}
