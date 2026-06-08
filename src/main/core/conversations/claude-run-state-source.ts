import { watch, type FSWatcher } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import type { RunStateEvent } from '@shared/events/agent-run-state';
import { resolveClaudeTranscriptPath } from '@main/core/session-title/claude-title-source';
import { log } from '@main/lib/logger';

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
export type ClaudeTurnState = 'working' | 'idle';

export async function readClaudeTurnState(
  cwd: string,
  sessionId: string
): Promise<ClaudeTurnState | null> {
  const filePath = resolveClaudeTranscriptPath(cwd, sessionId);
  let raw: string;
  try {
    raw = await readFile(filePath, 'utf8');
  } catch {
    return null;
  }
  return classifyClaudeTranscript(raw);
}

/** Pure classifier over raw transcript text. Exported for tests. */
export function classifyClaudeTranscript(raw: string): ClaudeTurnState {
  let lastUserIdx = -1;
  let lastStopIdx = -1;
  let idx = -1;

  for (const line of raw.split('\n')) {
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
      continue;
    }
    if (row.type === 'user') {
      const message = row.message;
      if (
        typeof message === 'object' &&
        message !== null &&
        (message as Record<string, unknown>).role === 'user'
      ) {
        lastUserIdx = idx;
      }
    }
  }

  if (lastUserIdx === -1) return 'idle';
  return lastUserIdx > lastStopIdx ? 'working' : 'idle';
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
    dispatch
  );
}

class ClaudeTranscriptStateTailer implements ClaudeRunStateWatcher {
  private watcher: FSWatcher | undefined;
  private readyTimer: NodeJS.Timeout | undefined;
  private readyDeadline = Date.now() + READY_POLL_MAX_MS;
  private reading = false;
  private pendingRead = false;
  private lastState: ClaudeTurnState | undefined;
  private stopped = false;

  constructor(
    private readonly filePath: string,
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
    const state = classifyClaudeTranscript(raw);
    const first = this.lastState === undefined;
    if (state === this.lastState) return;
    this.lastState = state;
    // On the very first read, only act if the session is actively working — a
    // first-read `idle` is the steady state and must not fire a spurious
    // `completed` (green dot) for a session that simply isn't running.
    if (first && state === 'idle') return;
    this.dispatch(
      state === 'working'
        ? { kind: 'turn-started', at: Date.now(), force: true }
        : { kind: 'turn-completed', at: Date.now() }
    );
  }
}
