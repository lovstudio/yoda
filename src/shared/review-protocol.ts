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

/**
 * The reviewer wraps its hand-off to the implementer between these two lines so
 * the orchestrator forwards only that — the reviewer's own conclusion — instead
 * of screen-scraping the noisy PTY buffer (TUI chrome, echoed prompts, the full
 * reasoning, and prior rounds in the reused session).
 */
const NOTES_OPEN = '<<<YODA_REVIEW_NOTES';
const NOTES_CLOSE = 'YODA_REVIEW_NOTES>>>';
const NOTES_PLACEHOLDER = '...short hand-off for agent A — essentials only...';
/** Cap on the screen-scrape fallback when the reviewer omits the notes block. */
const FEEDBACK_FALLBACK_CHARS = 4_000;

export interface ReviewResult {
  /** True only when the latest marker is PASS. */
  passed: boolean;
  /** True when at least one marker (PASS or FAIL) is present in the output. */
  hasMarker: boolean;
  /**
   * Number of markers in the output. The reviewer reuses a single session across
   * rounds, so its PTY buffer accumulates every round's verdict — the orchestrator
   * compares this against a per-round baseline to tell a fresh verdict from a
   * stale one left over from the previous round.
   */
  markerCount: number;
  /**
   * What to forward to the implementer: the reviewer's own hand-off note when it
   * wrote one, else a bounded tail of the cleaned buffer as a fallback.
   */
  feedback: string;
}

export function parseReviewResult(output: string): ReviewResult {
  const clean = stripTerminalControlSequences(output).trim();
  // Take the LAST verdict: the reviewer is told to end its turn with the marker,
  // so a match earlier in the buffer is at best a restated format and at worst a
  // stale verdict from a prior round. (The injected prompt uses a non-matching
  // `<PASS|FAIL>` placeholder so it can't be mistaken for a real verdict.)
  const matches = [...clean.matchAll(REVIEW_RESULT_MARKER)];
  const last = matches.at(-1);
  return {
    passed: last?.[1]?.toUpperCase() === 'PASS',
    hasMarker: last !== undefined,
    markerCount: matches.length,
    feedback: extractReviewNotes(clean) ?? clean.slice(-FEEDBACK_FALLBACK_CHARS),
  };
}

/** Pull the reviewer's last hand-off block; null if it didn't write a real one. */
function extractReviewNotes(clean: string): string | null {
  const open = clean.lastIndexOf(NOTES_OPEN);
  if (open === -1) return null;
  const afterOpen = open + NOTES_OPEN.length;
  const close = clean.indexOf(NOTES_CLOSE, afterOpen);
  if (close === -1) return null;
  const inner = clean.slice(afterOpen, close).trim();
  if (!inner || inner === NOTES_PLACEHOLDER) return null;
  return inner;
}

const REVIEW_PROTOCOL_LINES = [
  `Protocol:`,
  `- Do not modify files.`,
  `- Decide whether the implementation meets the requirement.`,
  `- If it does NOT, write a SHORT hand-off for implementer agent A — talk to`,
  `  them like a teammate in chat: just the key fixes and why, no full report and`,
  `  no restating their code back. Put it between these two lines exactly:`,
  `  ${NOTES_OPEN}`,
  `  ${NOTES_PLACEHOLDER}`,
  `  ${NOTES_CLOSE}`,
  `- End your response with a single status line, written exactly in this format`,
  `  (replace <PASS|FAIL> with the literal word PASS or FAIL):`,
  `  YODA_REVIEW_RESULT: <PASS|FAIL>`,
  `  Use PASS only when the implementation fully meets the requirement; else FAIL.`,
];

/** Round 1 review request — seeds the reviewer session with its system prompt. */
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
      ...REVIEW_PROTOCOL_LINES,
    ].join('\n')
  );
}

/**
 * Follow-up review request injected into the SAME reviewer session for round > 1
 * (after the implementer addressed the previous round's feedback). No system
 * prompt — the session already carries it from round 1.
 */
export function buildReviewFollowupPrompt(args: { round: number }): string {
  return [
    `Implementer agent A has addressed the previous review feedback.`,
    `Re-review the current state of the worktree.`,
    '',
    `Round: ${args.round}`,
    '',
    ...REVIEW_PROTOCOL_LINES,
  ].join('\n');
}

/**
 * Relay the reviewer's hand-off to the implementer like a chat message — just
 * the reviewer's note plus a nudge to act. No requirement restatement: the
 * implementer is the same long-running session and already has that context.
 */
export function buildImplementerFeedbackPrompt(args: { reviewFeedback: string }): string {
  return [
    `Reviewer agent B didn't pass your last change. Their note:`,
    '',
    args.reviewFeedback,
    '',
    `Address this in the same worktree and stop when the next round is complete.`,
  ].join('\n');
}
