import { watch, type FSWatcher } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import type { RunStateEvent } from '@shared/events/agent-run-state';
import { resolveClaudeTranscriptPath } from '@main/core/session-title/claude-title-source';
import { log } from '@main/lib/logger';
import { iterateLines } from '@main/utils/text-lines';
import { isInterruptedSinceLastPrompt } from './interrupt-marker';

/**
 * Deterministic "is this Claude session mid-turn?" check, read straight from the
 * transcript JSONL that Claude Code writes itself (~/.claude/projects/<cwd>/<id>.jsonl).
 *
 * Yoda's live run-state for Claude depends on the `Stop` hook being delivered.
 * When that hook is missed (stale port, hook not yet loaded, process restart)
 * the main-process store stays pinned at `working` forever — and re-opening the
 * session re-hydrates that stale value. This gives a hook-independent source of
 * truth to correct it on cold load.
 *
 * Heuristic: compare the line index of the last user message against the last
 * `stop_hook_summary`. Claude appends a `stop_hook_summary` system row at the end
 * of every turn. So:
 *   - last user message AFTER the last stop  → a turn is in progress → working
 *   - last stop AFTER the last user message   → the turn finished      → idle
 *   - no stop at all but a user message       → in progress (working)
 *   - no user message                         → idle
 *
 * Trailing metadata rows (`mode`, `permission-mode`, `ai-title`, …) are ignored;
 * only `user` messages and `stop_hook_summary` rows move the needle.
 */
export type ClaudeTurnState = 'working' | 'awaiting-input' | 'idle';

/** Tools that block the turn waiting for a user decision (no Notification hook). */
const INTERACTIVE_TOOLS = new Set(['AskUserQuestion', 'ExitPlanMode']);

/**
 * Sentinel rows Claude Code appends when the user presses Esc mid-turn. They
 * arrive as `type: "user"` messages, but they END the turn: no Stop hook fires
 * and no `stop_hook_summary` is written on interrupt, so without special-casing
 * them the classifier would pin the session at `working` forever.
 */
const INTERRUPT_SENTINELS = new Set([
  '[Request interrupted by user]',
  '[Request interrupted by user for tool use]',
]);

function isInterruptContent(content: unknown): boolean {
  if (!Array.isArray(content)) return false;
  return content.some(
    (item) =>
      typeof item === 'object' &&
      item !== null &&
      (item as Record<string, unknown>).type === 'text' &&
      INTERRUPT_SENTINELS.has((item as Record<string, unknown>).text as string)
  );
}

/**
 * A turn-state verdict plus the timestamp of the decisive prompt row it hangs
 * on, so callers can tell a fresh `working` from one frozen since before a
 * user interrupt (see interrupt-marker.ts).
 */
export interface ClaudeTurnVerdict {
  state: ClaudeTurnState;
  /** Epoch ms of the last non-interrupt user prompt row, if any. */
  lastUserAt: number | null;
  /** True when the current/last turn ended via Claude's transcript interrupt sentinel. */
  interrupted: boolean;
}

export async function readClaudeTurnState(
  cwd: string,
  sessionId: string
): Promise<ClaudeTurnState | null> {
  return readClaudeTurnStateFile(resolveClaudeTranscriptPath(cwd, sessionId));
}

/** Same as {@link readClaudeTurnState} for callers that already know the transcript path. */
export async function readClaudeTurnStateFile(filePath: string): Promise<ClaudeTurnState | null> {
  return (await readClaudeTurnVerdictFile(filePath))?.state ?? null;
}

/** Full verdict variant of {@link readClaudeTurnStateFile}. */
export async function readClaudeTurnVerdictFile(
  filePath: string
): Promise<ClaudeTurnVerdict | null> {
  let raw: string;
  try {
    raw = await readFile(filePath, 'utf8');
  } catch {
    return null;
  }
  return classifyClaudeTranscriptVerdict(raw);
}

/**
 * Pure classifier over raw transcript text. Exported for tests.
 *
 * Returns:
 *  - `awaiting-input` if an interactive tool (AskUserQuestion / ExitPlanMode) was
 *    issued but has no matching `tool_result` yet — the agent is blocked on the
 *    user. This is detected straight from the transcript, independent of the
 *    PreToolUse hook, so it can't be lost.
 *  - `working` if the last user message comes after the last `stop_hook_summary`
 *    (a turn is in progress).
 *  - `idle` otherwise (turn finished / nothing running).
 */
export function classifyClaudeTranscript(raw: string): ClaudeTurnState {
  return classifyClaudeTranscriptVerdict(raw).state;
}

/** Verdict variant of {@link classifyClaudeTranscript} (adds `lastUserAt`). */
export function classifyClaudeTranscriptVerdict(raw: string): ClaudeTurnVerdict {
  let lastUserIdx = -1;
  let lastUserAt: number | null = null;
  let lastStopIdx = -1;
  let idx = -1;
  let interrupted = false;
  const pendingInteractiveToolIds = new Set<string>();
  const resolvedToolIds = new Set<string>();

  for (const line of iterateLines(raw)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    idx += 1;
    let row: Record<string, unknown>;
    try {
      row = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (row.subtype === 'stop_hook_summary') {
      lastStopIdx = idx;
      interrupted = false;
      continue;
    }
    const message = row.message;
    const content =
      typeof message === 'object' && message !== null
        ? (message as Record<string, unknown>).content
        : undefined;
    if (Array.isArray(content)) {
      for (const item of content) {
        if (typeof item !== 'object' || item === null) continue;
        const it = item as Record<string, unknown>;
        if (
          it.type === 'tool_use' &&
          typeof it.name === 'string' &&
          INTERACTIVE_TOOLS.has(it.name) &&
          typeof it.id === 'string'
        ) {
          pendingInteractiveToolIds.add(it.id);
        }
        if (it.type === 'tool_result' && typeof it.tool_use_id === 'string') {
          resolvedToolIds.add(it.tool_use_id);
        }
      }
    }
    if (row.type === 'user') {
      if (
        typeof message === 'object' &&
        message !== null &&
        (message as Record<string, unknown>).role === 'user'
      ) {
        // An Esc interrupt is written as a user row but terminates the turn.
        if (isInterruptContent(content)) {
          lastStopIdx = idx;
          interrupted = true;
        } else {
          lastUserIdx = idx;
          const at = typeof row.timestamp === 'string' ? Date.parse(row.timestamp) : NaN;
          lastUserAt = Number.isNaN(at) ? null : at;
          interrupted = false;
        }
      }
    }
  }

  // An interactive tool with no matching result = blocked on the user.
  for (const id of pendingInteractiveToolIds) {
    if (!resolvedToolIds.has(id)) return { state: 'awaiting-input', lastUserAt, interrupted };
  }

  if (lastUserIdx === -1) return { state: 'idle', lastUserAt, interrupted };
  return { state: lastUserIdx > lastStopIdx ? 'working' : 'idle', lastUserAt, interrupted };
}

// ── Live tailer ──────────────────────────────────────────────────────────────

const READY_POLL_INTERVAL_MS = 1_000;
const READY_POLL_MAX_MS = 5 * 60_000;

export type RunStateDispatch = (event: RunStateEvent) => void;

export interface ClaudeRunStateWatcher {
  stop(): void;
}

export interface ClaudeRunStateContext {
  cwd: string;
  conversationId: string;
}

/**
 * Live run-state source for Claude sessions — the turn-boundary signal Yoda was
 * missing. Claude Code writes every user message and `stop_hook_summary` into
 * its transcript JSONL; we watch that file and re-derive working/idle on every
 * change. This is independent of how the user submits (Yoda input box OR typing
 * directly in the terminal TUI) and independent of hook delivery, so it is the
 * authoritative turn-started / turn-ended source for Claude, mirroring the Codex
 * rollout tailer.
 */
export function watchClaudeRunState(
  ctx: ClaudeRunStateContext,
  dispatch: RunStateDispatch
): ClaudeRunStateWatcher {
  return new ClaudeTranscriptStateTailer(
    resolveClaudeTranscriptPath(ctx.cwd, ctx.conversationId),
    ctx.conversationId,
    dispatch
  );
}

class ClaudeTranscriptStateTailer implements ClaudeRunStateWatcher {
  private watcher: FSWatcher | undefined;
  private readyTimer: NodeJS.Timeout | undefined;
  private readyDeadline = Date.now() + READY_POLL_MAX_MS;
  private reading = false;
  private pendingRead = false;
  /**
   * Dedup key: state + timestamp of the decisive prompt row. State alone is
   * not enough — a stale `working` that was force-cleared (interrupt with no
   * sentinel) keeps classifying as `working` when the NEXT prompt arrives, and
   * a state-only dedup would swallow that turn's `turn-started` forever. A new
   * prompt row moves `lastUserAt`, so the fingerprint changes and the event is
   * re-dispatched; the reducer is idempotent, so re-asserting `working` mid-turn
   * is harmless (it also feeds the watchdog's `updatedAt`).
   */
  private lastFingerprint: string | undefined;
  /** Previous classified state — needed to detect awaiting-input → working. */
  private lastState: ClaudeTurnState | undefined;
  private stopped = false;

  constructor(
    private readonly filePath: string,
    private readonly conversationId: string,
    private readonly dispatch: RunStateDispatch
  ) {
    this.waitForFile();
  }

  stop(): void {
    this.stopped = true;
    if (this.readyTimer) {
      clearTimeout(this.readyTimer);
      this.readyTimer = undefined;
    }
    if (this.watcher) {
      try {
        this.watcher.close();
      } catch {}
      this.watcher = undefined;
    }
  }

  private waitForFile(): void {
    if (this.stopped) return;
    stat(this.filePath)
      .then(() => this.attach())
      .catch(() => {
        if (this.stopped || Date.now() > this.readyDeadline) return;
        this.readyTimer = setTimeout(() => this.waitForFile(), READY_POLL_INTERVAL_MS);
      });
  }

  private attach(): void {
    if (this.stopped) return;
    try {
      this.watcher = watch(this.filePath, () => this.scheduleRead());
      this.watcher.on('error', (err) => {
        log.warn('ClaudeRunStateSource: watch error', {
          filePath: this.filePath,
          error: String(err),
        });
      });
    } catch (err) {
      log.warn('ClaudeRunStateSource: failed to attach watcher', {
        filePath: this.filePath,
        error: String(err),
      });
      return;
    }
    this.scheduleRead();
  }

  private scheduleRead(): void {
    if (this.stopped) return;
    if (this.reading) {
      this.pendingRead = true;
      return;
    }
    this.reading = true;
    void this.reclassify()
      .catch((err) => {
        log.warn('ClaudeRunStateSource: read error', {
          filePath: this.filePath,
          error: String(err),
        });
      })
      .finally(() => {
        this.reading = false;
        if (this.pendingRead && !this.stopped) {
          this.pendingRead = false;
          this.scheduleRead();
        }
      });
  }

  private async reclassify(): Promise<void> {
    const raw = await readFile(this.filePath, 'utf8').catch(() => undefined);
    if (raw === undefined || this.stopped) return;
    const verdict = classifyClaudeTranscriptVerdict(raw);
    let state = verdict.state;
    // A `working` verdict frozen since before a user interrupt is stale (turn
    // killed before its first assistant output — no sentinel, no stop row).
    // Without this gate, attaching to such a transcript would resurrect the
    // zombie `working` that the interrupt just cleared.
    if (
      state === 'working' &&
      isInterruptedSinceLastPrompt(this.conversationId, verdict.lastUserAt)
    ) {
      state = 'idle';
    }
    const fingerprint = `${state}@${verdict.lastUserAt ?? ''}`;
    const first = this.lastFingerprint === undefined;
    if (fingerprint === this.lastFingerprint) return;
    this.lastFingerprint = fingerprint;
    const previousState = this.lastState;
    this.lastState = state;
    // On the very first read, only act if the session is actively running — a
    // first-read `idle` is the steady state and must not fire a spurious
    // `completed` (green dot) for a session that simply isn't running.
    if (first && state === 'idle') return;
    this.dispatch(eventForClaudeVerdict(state, verdict, previousState));
  }
}

function eventForClaudeVerdict(
  state: ClaudeTurnState,
  verdict: ClaudeTurnVerdict,
  previousState?: ClaudeTurnState
): RunStateEvent {
  switch (state) {
    case 'working':
      // awaiting-input → working means the transcript recorded the tool_result
      // for the pending interactive tool — the user answered. Force the
      // transition so the reducer's "keep awaiting-input on non-forced starts"
      // guard doesn't pin the stale prompt state when the PostToolUse hook is
      // missed (mirrors the Codex rollout tailer's resolved-call handling).
      if (previousState === 'awaiting-input') {
        return { kind: 'turn-started', at: Date.now(), force: true };
      }
      // NOT forced: the tailer only *observes* that a turn is in progress, so it
      // must not clear a more specific awaiting-input sub-state set elsewhere.
      return { kind: 'turn-started', at: Date.now() };
    case 'awaiting-input':
      return {
        kind: 'awaiting-input',
        at: Date.now(),
        pendingAction: { notificationType: 'elicitation_dialog' },
      };
    case 'idle':
      return { kind: verdict.interrupted ? 'turn-interrupted' : 'turn-completed', at: Date.now() };
  }
}
