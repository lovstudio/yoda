import { watch, type FSWatcher } from 'node:fs';
import { open } from 'node:fs/promises';
import type { RunStateEvent } from '@shared/events/agent-run-state';
import {
  getClaimedCodexThreadId,
  readCodexThreadRolloutPath,
  resolveCodexStatePath,
} from '@main/core/session-title/codex-title-source';
import { log } from '@main/lib/logger';

/**
 * Deterministic run-state source for Codex sessions.
 *
 * Codex writes every turn boundary into its rollout JSONL
 * (`~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`) — the same file the PTY
 * process owns and writes. We only read it, so there is zero contention with
 * the running `codex` CLI (unlike app-server, which would need to take
 * ownership of the thread).
 *
 * The relevant `event_msg` rows:
 *   - `task_started`  → a turn began            → `turn-started`
 *   - `task_complete` → a turn finished cleanly → `turn-completed`
 *   - `turn_aborted`  → a turn was cut short    → `turn-interrupted` (reason
 *     `interrupted`) or `turn-failed` (any other reason)
 *
 * This replaces the 2.5s text-heuristic classifier as the authoritative source
 * for Codex; the classifier stays only as a fallback when the rollout cannot be
 * located.
 */

const BIND_POLL_INTERVAL_MS = 1_000;
const BIND_POLL_MAX_MS = 5 * 60_000;

export interface CodexRunStateContext {
  conversationId: string;
  cwd: string;
  startedAtMs: number;
}

export type RunStateDispatch = (event: RunStateEvent) => void;

export interface CodexRunStateWatcher {
  stop(): void;
}

export function watchCodexRunState(
  ctx: CodexRunStateContext,
  dispatch: RunStateDispatch,
  options: { statePath?: string } = {}
): CodexRunStateWatcher {
  return new CodexRolloutTailer(ctx, dispatch, options.statePath ?? resolveCodexStatePath());
}

class CodexRolloutTailer implements CodexRunStateWatcher {
  private bindTimer: NodeJS.Timeout | undefined;
  private readonly bindDeadline: number;
  private watcher: FSWatcher | undefined;
  private rolloutPath: string | undefined;
  private offset = 0;
  private buffer = '';
  private reading = false;
  private pendingRead = false;
  private stopped = false;

  constructor(
    private readonly ctx: CodexRunStateContext,
    private readonly dispatch: RunStateDispatch,
    private readonly statePath: string
  ) {
    this.bindDeadline = ctx.startedAtMs + BIND_POLL_MAX_MS;
    this.scheduleBind(0);
  }

  stop(): void {
    this.stopped = true;
    if (this.bindTimer) {
      clearTimeout(this.bindTimer);
      this.bindTimer = undefined;
    }
    if (this.watcher) {
      try {
        this.watcher.close();
      } catch {}
      this.watcher = undefined;
    }
  }

  /**
   * The rollout path is not known until the rename poller has bound this
   * conversation to a Codex thread (and Codex has flushed `rollout_path` into
   * `state_5.sqlite`). Poll for it, then attach the file tailer.
   */
  private scheduleBind(delayMs: number): void {
    if (this.stopped) return;
    this.bindTimer = setTimeout(() => this.tryBind(), delayMs);
  }

  private tryBind(): void {
    if (this.stopped) return;
    try {
      const threadId = getClaimedCodexThreadId(this.ctx.conversationId);
      const rolloutPath = threadId
        ? readCodexThreadRolloutPath(this.statePath, threadId)
        : undefined;
      if (rolloutPath) {
        this.rolloutPath = rolloutPath;
        this.attach();
        return;
      }
    } catch (error) {
      log.warn('CodexRunStateSource: bind failed', {
        conversationId: this.ctx.conversationId,
        error: String(error),
      });
    }
    if (Date.now() <= this.bindDeadline) {
      this.scheduleBind(BIND_POLL_INTERVAL_MS);
    }
  }

  private attach(): void {
    if (this.stopped || !this.rolloutPath) return;
    const path = this.rolloutPath;
    try {
      this.watcher = watch(path, () => this.scheduleRead());
      this.watcher.on('error', (err) => {
        log.warn('CodexRunStateSource: watch error', { path, error: String(err) });
      });
    } catch (err) {
      log.warn('CodexRunStateSource: failed to attach watcher', { path, error: String(err) });
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
    void this.readAppended()
      .catch((err) => {
        log.warn('CodexRunStateSource: read error', {
          path: this.rolloutPath,
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

  private async readAppended(): Promise<void> {
    if (!this.rolloutPath) return;
    const fileHandle = await open(this.rolloutPath, 'r').catch(() => undefined);
    if (!fileHandle) return;
    try {
      const stats = await fileHandle.stat();
      if (stats.size < this.offset) {
        this.offset = 0;
        this.buffer = '';
      }
      if (stats.size === this.offset) return;
      const length = stats.size - this.offset;
      const buf = Buffer.alloc(length);
      await fileHandle.read(buf, 0, length, this.offset);
      this.offset = stats.size;
      this.buffer += buf.toString('utf8');

      let nl = this.buffer.indexOf('\n');
      while (nl !== -1) {
        const line = this.buffer.slice(0, nl).trim();
        this.buffer = this.buffer.slice(nl + 1);
        if (line) this.handleLine(line);
        nl = this.buffer.indexOf('\n');
      }
    } finally {
      await fileHandle.close();
    }
  }

  private handleLine(line: string): void {
    if (this.stopped) return;
    const event = parseTurnEvent(line);
    if (!event) return;
    this.dispatch(event);
  }
}

/**
 * Parse a single rollout JSONL line into a reducer event, or null if it is not
 * a turn-boundary event. Exported for tests.
 */
export function parseTurnEvent(line: string): RunStateEvent | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const row = parsed as Record<string, unknown>;
  if (row.type !== 'event_msg') return null;
  const payload = row.payload;
  if (typeof payload !== 'object' || payload === null) return null;
  const p = payload as Record<string, unknown>;
  const at = parseTimestampMs(row.timestamp) ?? Date.now();

  switch (p.type) {
    case 'task_started':
      return { kind: 'turn-started', at };
    case 'task_complete':
      return { kind: 'turn-completed', at };
    case 'turn_aborted':
      return p.reason === 'interrupted'
        ? { kind: 'turn-interrupted', at }
        : { kind: 'turn-failed', at };
    default:
      return null;
  }
}

function parseTimestampMs(value: unknown): number | undefined {
  if (typeof value !== 'string') return undefined;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? undefined : ms;
}
