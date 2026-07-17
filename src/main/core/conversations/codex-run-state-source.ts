import { watch, type FSWatcher } from 'node:fs';
import { open, type FileHandle } from 'node:fs/promises';
import {
  initialRunState,
  reduceRunState,
  type RunStateEvent,
} from '@shared/events/agent-run-state';
import {
  findClosestCodexThreadRolloutByCreatedAt,
  findRecentCodexThreadRollout,
  getClaimedCodexThreadId,
  readCodexThreadRolloutPath,
  resolveCodexStatePath,
} from '@main/core/session-title/codex-title-source';
import { log } from '@main/lib/logger';
import { iterateLines } from '@main/utils/text-lines';

export type CodexTurnState = 'working' | 'awaiting-input' | 'idle' | 'error';

export interface CodexTurnVerdict {
  state: CodexTurnState;
  lastStartedAt: number | null;
}

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
const RESUME_START_GRACE_MS = 10_000;
const NEW_SESSION_THREAD_CREATE_MAX_DISTANCE_MS = 60_000;
const REQUEST_USER_INPUT_TOOL = 'request_user_input';
const RUN_STATE_SCAN_CHUNK_BYTES = 256 * 1024;
const MAX_RUN_STATE_LINE_BYTES = 2 * 1024 * 1024;
const RUN_STATE_LINE_MARKERS = [
  Buffer.from('"task_started"'),
  Buffer.from('"task_complete"'),
  Buffer.from('"turn_aborted"'),
  Buffer.from('"request_user_input"'),
  Buffer.from('"function_call_output"'),
];

export interface CodexRunStateContext {
  conversationId: string;
  cwd: string;
  startedAtMs: number;
  isResuming?: boolean;
  /** Persisted/resolved Codex thread id. Avoids cwd-based fallback collisions. */
  threadId?: string;
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
  private readonly pendingRequestUserInputCallIds = new Set<string>();

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
   * The rollout path is not available until Codex creates its thread row and
   * flushes `rollout_path` into `state_5.sqlite`. Prefer the title poller's
   * explicit claim when present, but do not depend on title generation: early
   * interrupts still need the run-state tailer, so fall back to the thread row
   * nearest this session's start time.
   */
  private scheduleBind(delayMs: number): void {
    if (this.stopped) return;
    this.bindTimer = setTimeout(() => this.tryBind(), delayMs);
  }

  private tryBind(): void {
    if (this.stopped) return;
    try {
      const rolloutPath = resolveCodexRolloutPathForConversation({
        ...this.ctx,
        statePath: this.statePath,
      });
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
    const event = parseCodexRunStateEvent(line, this.pendingRequestUserInputCallIds);
    if (!event) return;
    this.dispatch(event);
  }
}

export function resolveCodexRolloutPathForConversation({
  conversationId,
  cwd,
  startedAtMs,
  isResuming,
  threadId,
  statePath = resolveCodexStatePath(),
}: CodexRunStateContext & { statePath?: string }): string | undefined {
  if (threadId) {
    const explicit = readCodexThreadRolloutPath(statePath, threadId);
    if (explicit) return explicit;
  }

  const claimedThreadId = getClaimedCodexThreadId(conversationId);
  if (claimedThreadId) {
    const claimed = readCodexThreadRolloutPath(statePath, claimedThreadId);
    if (claimed) return claimed;
  }

  const direct = readCodexThreadRolloutPath(statePath, conversationId);
  if (direct) return direct;

  const row = isResuming
    ? findRecentCodexThreadRollout({
        statePath,
        cwd,
        minUpdatedAtMs: startedAtMs - RESUME_START_GRACE_MS,
      })
    : findClosestCodexThreadRolloutByCreatedAt({
        statePath,
        cwd,
        targetCreatedAtMs: startedAtMs,
        maxDistanceMs: NEW_SESSION_THREAD_CREATE_MAX_DISTANCE_MS,
      });
  return row?.rolloutPath;
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

/**
 * Parse any rollout line that can change live run-state. Turn-boundary events
 * are persisted as `event_msg` rows. Codex request_user_input pending is not:
 * the app-server request is deliberately excluded from rollout, so the closest
 * durable signal is the Response API `function_call` plus its later output.
 */
export function parseCodexRunStateEvent(
  line: string,
  pendingRequestUserInputCallIds = new Set<string>()
): RunStateEvent | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const row = parsed as Record<string, unknown>;
  const at = parseTimestampMs(row.timestamp) ?? Date.now();

  if (row.type === 'event_msg') {
    const event = parseTurnEvent(line);
    if (
      event?.kind === 'turn-completed' ||
      event?.kind === 'turn-interrupted' ||
      event?.kind === 'turn-failed'
    ) {
      pendingRequestUserInputCallIds.clear();
    }
    return event;
  }

  if (row.type !== 'response_item') return null;
  const payload = row.payload;
  if (typeof payload !== 'object' || payload === null) return null;
  const p = payload as Record<string, unknown>;

  if (
    p.type === 'function_call' &&
    p.name === REQUEST_USER_INPUT_TOOL &&
    typeof p.call_id === 'string'
  ) {
    pendingRequestUserInputCallIds.add(p.call_id);
    return {
      kind: 'awaiting-input',
      at,
      pendingAction: {
        notificationType: 'elicitation_dialog',
        toolName: REQUEST_USER_INPUT_TOOL,
        actionDescription: summarizeRequestUserInputArguments(p.arguments),
      },
    };
  }

  if (
    p.type === 'function_call_output' &&
    typeof p.call_id === 'string' &&
    pendingRequestUserInputCallIds.delete(p.call_id)
  ) {
    return { kind: 'turn-started', at, force: true };
  }

  return null;
}

function parseTimestampMs(value: unknown): number | undefined {
  if (typeof value !== 'string') return undefined;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? undefined : ms;
}

/**
 * Point-in-time run-state for a Codex conversation, derived by folding all turn
 * events in its rollout JSONL. Used for stateless cold-load reads (no reliance
 * on in-memory state that a main-process restart would lose). Returns null if
 * the rollout can't be located.
 */
export async function readCodexTurnState(
  conversationId: string,
  options: Partial<Omit<CodexRunStateContext, 'conversationId'>> & { statePath?: string } = {}
): Promise<CodexTurnState | null> {
  return (await readCodexTurnVerdict(conversationId, options))?.state ?? null;
}

export async function readCodexTurnVerdict(
  conversationId: string,
  options: Partial<Omit<CodexRunStateContext, 'conversationId'>> & { statePath?: string } = {}
): Promise<CodexTurnVerdict | null> {
  const statePath = options.statePath ?? resolveCodexStatePath();
  const rolloutPath =
    options.cwd && options.startedAtMs !== undefined
      ? resolveCodexRolloutPathForConversation({
          conversationId,
          cwd: options.cwd,
          startedAtMs: options.startedAtMs,
          isResuming: options.isResuming,
          statePath,
        })
      : readCodexThreadRolloutPath(
          statePath,
          getClaimedCodexThreadId(conversationId) ?? conversationId
        );
  if (!rolloutPath) return null;
  return readCodexTurnVerdictFile(rolloutPath);
}

/**
 * Read only the newest run-state segment from a Codex rollout.
 *
 * Rollouts can contain image/tool payloads hundreds of megabytes large. Reading
 * the whole file briefly keeps the Buffer, decoded string, and parsed JSON in
 * the Electron main-process heap at once. Scan backwards in fixed-size chunks
 * instead and stop at the most recent turn boundary; older rows cannot affect
 * the current verdict.
 */
export async function readCodexTurnVerdictFile(
  rolloutPath: string
): Promise<CodexTurnVerdict | null> {
  const file = await open(rolloutPath, 'r').catch(() => undefined);
  if (!file) return null;
  try {
    const { size } = await file.stat();
    const lines = await readRecentRunStateLines(file, size);
    return classifyCodexRollout(lines.join('\n'));
  } finally {
    await file.close();
  }
}

async function readRecentRunStateLines(file: FileHandle, size: number): Promise<string[]> {
  const newestFirst: string[] = [];
  let position = size;
  let carry = Buffer.alloc(0);
  let discardingOversizedLine = false;

  const collect = (line: Buffer): boolean => {
    if (
      line.length === 0 ||
      line.length > MAX_RUN_STATE_LINE_BYTES ||
      !RUN_STATE_LINE_MARKERS.some((marker) => line.includes(marker))
    ) {
      return false;
    }
    const text = line.toString('utf8').trim();
    if (!text) return false;
    newestFirst.push(text);
    return parseTurnEvent(text)?.kind === 'turn-started';
  };

  while (position > 0) {
    const start = Math.max(0, position - RUN_STATE_SCAN_CHUNK_BYTES);
    const chunk = Buffer.allocUnsafe(position - start);
    const { bytesRead } = await file.read(chunk, 0, chunk.length, start);
    position = start;
    let data = chunk.subarray(0, bytesRead);

    if (discardingOversizedLine) {
      const separator = data.lastIndexOf(0x0a);
      if (separator < 0) continue;
      data = data.subarray(0, separator + 1);
      discardingOversizedLine = false;
    }

    const lastSeparator = data.lastIndexOf(0x0a);
    if (lastSeparator < 0 && data.length + carry.length > MAX_RUN_STATE_LINE_BYTES) {
      carry = Buffer.alloc(0);
      discardingOversizedLine = true;
      continue;
    }

    const combined = carry.length > 0 ? Buffer.concat([data, carry]) : data;
    const firstSeparator = combined.indexOf(0x0a);
    if (firstSeparator < 0) {
      carry = combined;
      continue;
    }

    let lineEnd = combined.length;
    for (let separator = combined.lastIndexOf(0x0a, lineEnd - 1); separator >= firstSeparator; ) {
      if (collect(combined.subarray(separator + 1, lineEnd))) {
        return newestFirst.reverse();
      }
      lineEnd = separator;
      if (separator === firstSeparator) break;
      separator = combined.lastIndexOf(0x0a, separator - 1);
    }
    carry = combined.subarray(0, firstSeparator);
  }

  if (!discardingOversizedLine && carry.length > 0) collect(carry);
  return newestFirst.reverse();
}

export function classifyCodexRollout(raw: string): CodexTurnVerdict {
  let state = initialRunState();
  let lastStartedAt: number | null = null;
  const pendingRequestUserInputCallIds = new Set<string>();
  for (const line of iterateLines(raw)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const event = parseCodexRunStateEvent(trimmed, pendingRequestUserInputCallIds);
    if (event) {
      if (event.kind === 'turn-started') lastStartedAt = event.at;
      state = reduceRunState(state, event);
    }
  }
  if (state.status === 'awaiting-input') return { state: 'awaiting-input', lastStartedAt };
  if (state.status === 'working') return { state: 'working', lastStartedAt };
  if (state.status === 'error') return { state: 'error', lastStartedAt };
  return { state: 'idle', lastStartedAt };
}

function summarizeRequestUserInputArguments(value: unknown): string | undefined {
  if (typeof value !== 'string') return REQUEST_USER_INPUT_TOOL;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return REQUEST_USER_INPUT_TOOL;
  }
  if (typeof parsed !== 'object' || parsed === null) return REQUEST_USER_INPUT_TOOL;
  const questions = (parsed as Record<string, unknown>).questions;
  if (!Array.isArray(questions) || questions.length === 0) return REQUEST_USER_INPUT_TOOL;
  const first = questions[0];
  const question =
    typeof first === 'object' && first !== null
      ? (first as Record<string, unknown>).question
      : undefined;
  if (typeof question === 'string' && question.trim()) {
    return questions.length === 1
      ? question.trim()
      : `${question.trim()} (+${questions.length - 1} more)`;
  }
  return questions.length === 1 ? 'Question requested' : `${questions.length} questions requested`;
}
