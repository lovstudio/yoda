import { formatTerminalLogContent } from '@shared/terminal-log';
import { getExitCodeMeaning, normalizeSignal } from './exit-signals';
import type { PtyExitInfo } from './pty';
import { ptySessionRegistry } from './pty-session-registry';

/**
 * Diagnostics for an Agent CLI that ended without saying why.
 *
 * A provider CLI can die mid-turn — relay hangup, OOM, an unhandled rejection
 * inside its own TUI — and leave nothing behind: the transcript stops after the
 * last tool result, no API error is persisted, and Yoda's next `--resume` lands
 * the CLI at an idle prompt instead of continuing the interrupted turn. The
 * only surviving evidence is what the process printed on its way out, so it is
 * captured here and stored with the run instead of being dropped.
 */

const MAX_TAIL_LINES = 40;
const MAX_TAIL_CHARS = 4_000;

/**
 * Snapshot the dying screen of a session.
 *
 * Must be called synchronously from a `pty.onExit` handler: exit finalization
 * clears the replay ring buffer, after which this output is unrecoverable.
 */
export function captureAgentExitTail(sessionId: string): string {
  return formatAgentExitTail(ptySessionRegistry.snapshot(sessionId));
}

/** Keep the readable end of a raw replay buffer — the end is where errors are. */
export function formatAgentExitTail(rawBuffer: string): string {
  if (!rawBuffer) return '';
  const lines = formatTerminalLogContent(rawBuffer)
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0);
  const tail = lines.slice(-MAX_TAIL_LINES).join('\n');
  return tail.length > MAX_TAIL_CHARS ? tail.slice(tail.length - MAX_TAIL_CHARS) : tail;
}

/** Human-readable exit reason, preferring the signal name over a bare number. */
export function describeAgentExit({ exitCode, signal }: PtyExitInfo): string {
  const normalizedSignal = normalizeSignal(signal);
  if (normalizedSignal) return `Signal ${normalizedSignal}`;
  if (signal !== undefined && signal !== 0) return `Signal ${String(signal)}`;
  if (typeof exitCode === 'number')
    return `Exit code ${exitCode} (${getExitCodeMeaning(exitCode)})`;
  return 'Exited without an exit code or signal';
}
