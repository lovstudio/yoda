import { watch, type FSWatcher } from 'node:fs';
import { stat } from 'node:fs/promises';
import { eq } from 'drizzle-orm';
import { conversationTranscriptChangedChannel } from '@shared/events/conversationEvents';
import {
  resolveClaudeTranscriptPath,
  resolveClaudeTranscriptPathFromConfigDir,
} from '@main/core/session-title/claude-title-source';
import { runtimeOverrideSettings } from '@main/core/settings/runtime-settings-service';
import { db } from '@main/db/client';
import { conversations } from '@main/db/schema';
import { events } from '@main/lib/events';
import { log } from '@main/lib/logger';
import { resolveTask } from '../projects/utils';
import { findClaudeTranscriptPathBySessionId } from './claude-transcript-locator';
import { getReservedCodexThreadIds } from './codex-thread-reservations';
import { getConversationRuntimeStateRoot } from './conversation-session-source';
import { getCodexSessionRolloutPath } from './getCodexSessionContext';
import { readIncrementalTranscriptTail } from './incremental-transcript-tail-reader';
import { mapConversationRowToConversation } from './utils';

/**
 * Live transcript feed for the sidebar Transcript panel: the RAW on-disk JSONL
 * the CLI itself writes (Claude session transcript / Codex rollout) — every
 * line complete and unfiltered, plus a ref-counted fs.watch so the renderer
 * can mirror the file in real time. The panel tails the last lines; the full
 * file opens in the regular file viewer via `filePath`.
 */

const DEBOUNCE_MS = 250;
const READY_POLL_INTERVAL_MS = 1_000;
const READY_POLL_MAX_INTERVAL_MS = 10_000;
export interface ConversationTranscript {
  /** Absolute path of the JSONL file, for opening in the file viewer. */
  filePath: string | null;
  /** Total JSONL lines in the file (non-empty). */
  totalLines: number;
  /** The last 500 raw JSONL lines, in file order. */
  lines: string[];
}

const EMPTY_TRANSCRIPT: ConversationTranscript = { filePath: null, totalLines: 0, lines: [] };
type TranscriptChangeListener = () => void;

/**
 * Monotonic per-conversation counter, bumped on every observed transcript
 * write. Cached transcript readers fold it into their cache key so a read
 * triggered *by* a change event can never be served a value computed before
 * that write — a TTL alone would keep serving the pre-write parse.
 *
 * Kept for the process lifetime (one integer per conversation ever watched):
 * dropping it when the watch stops would restart the count and let a surviving
 * cache entry look current again.
 */
const transcriptRevisions = new Map<string, number>();

export function conversationTranscriptRevision(conversationId: string): number {
  return transcriptRevisions.get(conversationId) ?? 0;
}

function transcriptWatchKey(projectId: string, taskId: string, conversationId: string): string {
  return `${projectId}\0${taskId}\0${conversationId}`;
}

export async function getConversationTranscript(
  projectId: string,
  taskId: string,
  conversationId: string
): Promise<ConversationTranscript> {
  const watchEntry = watches.get(transcriptWatchKey(projectId, taskId, conversationId));
  const filePath =
    watchEntry?.filePath ?? (await resolveTranscriptPath(projectId, taskId, conversationId));
  if (!filePath) return EMPTY_TRANSCRIPT;

  try {
    const transcript = await readIncrementalTranscriptTail(filePath);
    return { filePath, ...transcript };
  } catch {
    return { ...EMPTY_TRANSCRIPT, filePath };
  }
}

// ── Live watch (ref-counted per conversation) ────────────────────────────────

class TranscriptWatch {
  refs = 0;
  readonly listeners = new Set<TranscriptChangeListener>();
  filePath: string | null = null;
  private readonly initialAttempt: Promise<void>;
  private watcher: FSWatcher | undefined;
  private readyTimer: NodeJS.Timeout | undefined;
  private debounceTimer: NodeJS.Timeout | undefined;
  private readyPollInterval = READY_POLL_INTERVAL_MS;
  private stopped = false;

  constructor(
    private readonly projectId: string,
    private readonly taskId: string,
    private readonly conversationId: string
  ) {
    this.initialAttempt = this.waitForTranscript();
  }

  waitUntilInitialAttempt(): Promise<void> {
    return this.initialAttempt;
  }

  stop(): void {
    this.stopped = true;
    if (this.readyTimer) clearTimeout(this.readyTimer);
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    try {
      this.watcher?.close();
    } catch {}
    this.watcher = undefined;
    this.filePath = null;
    this.listeners.clear();
  }

  private async waitForTranscript(): Promise<void> {
    if (this.stopped) return;
    try {
      const filePath = await resolveTranscriptPath(
        this.projectId,
        this.taskId,
        this.conversationId
      );
      if (!filePath) throw new Error('Transcript path is not ready.');
      await stat(filePath);
      if (this.stopped) return;
      this.attach(filePath);
    } catch {
      if (this.stopped) return;
      this.scheduleReadyRetry();
    }
  }

  private attach(filePath: string): void {
    if (this.stopped) return;
    try {
      const watcher = watch(filePath, (eventType) => {
        this.scheduleEmit();
        if (eventType === 'rename') this.restart(watcher);
      });
      this.watcher = watcher;
      this.filePath = filePath;
      this.readyPollInterval = READY_POLL_INTERVAL_MS;
      watcher.on('error', (error) => {
        log.warn('TranscriptFeed: watcher failed; retrying', {
          filePath,
          error: String(error),
        });
        this.restart(watcher);
      });
    } catch (err) {
      log.warn('TranscriptFeed: failed to attach watcher', {
        filePath,
        error: String(err),
      });
      this.scheduleReadyRetry();
      return;
    }
    // The file may have grown between getConversationTranscript and attach.
    this.scheduleEmit();
  }

  private restart(watcher: FSWatcher): void {
    if (this.stopped || this.watcher !== watcher) return;
    try {
      watcher.close();
    } catch {}
    this.watcher = undefined;
    this.filePath = null;
    this.readyPollInterval = READY_POLL_INTERVAL_MS;
    this.scheduleReadyRetry();
  }

  private scheduleReadyRetry(): void {
    if (this.stopped || this.readyTimer) return;
    this.readyTimer = setTimeout(() => {
      this.readyTimer = undefined;
      void this.waitForTranscript();
    }, this.readyPollInterval);
    this.readyPollInterval = Math.min(READY_POLL_MAX_INTERVAL_MS, this.readyPollInterval * 2);
    this.readyTimer.unref?.();
  }

  private scheduleEmit(): void {
    if (this.stopped || this.debounceTimer) return;
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = undefined;
      if (this.stopped) return;
      // Bump before notifying: every listener that reads as a result of this
      // event must miss any cache entry built from the previous revision.
      transcriptRevisions.set(
        this.conversationId,
        conversationTranscriptRevision(this.conversationId) + 1
      );
      for (const listener of this.listeners) {
        try {
          listener();
        } catch (error) {
          log.warn('TranscriptFeed: local listener failed', {
            conversationId: this.conversationId,
            error: String(error),
          });
        }
      }
      events.emit(
        conversationTranscriptChangedChannel,
        { conversationId: this.conversationId },
        this.conversationId
      );
    }, DEBOUNCE_MS);
  }
}

const watches = new Map<string, TranscriptWatch>();

export async function subscribeConversationTranscript(
  projectId: string,
  taskId: string,
  conversationId: string
): Promise<void> {
  await acquireConversationTranscript(projectId, taskId, conversationId);
}

/** Main-process-only transcript subscription used by the mobile SSE gateway. */
export async function subscribeConversationTranscriptChanges(
  projectId: string,
  taskId: string,
  conversationId: string,
  listener: TranscriptChangeListener
): Promise<() => void> {
  const key = transcriptWatchKey(projectId, taskId, conversationId);
  const entry = await acquireConversationTranscript(projectId, taskId, conversationId, listener);
  if (!entry) return () => {};

  let active = true;
  return () => {
    if (!active) return;
    active = false;
    releaseConversationTranscript(key, listener);
  };
}

async function acquireConversationTranscript(
  projectId: string,
  taskId: string,
  conversationId: string,
  listener?: TranscriptChangeListener
): Promise<TranscriptWatch | null> {
  const key = transcriptWatchKey(projectId, taskId, conversationId);
  const existing = watches.get(key);
  if (existing) {
    existing.refs += 1;
    if (listener) existing.listeners.add(listener);
    await existing.waitUntilInitialAttempt();
    return existing;
  }
  const watchEntry = new TranscriptWatch(projectId, taskId, conversationId);
  watchEntry.refs = 1;
  if (listener) watchEntry.listeners.add(listener);
  watches.set(key, watchEntry);
  await watchEntry.waitUntilInitialAttempt();
  return watchEntry;
}

export async function unsubscribeConversationTranscript(
  projectId: string,
  taskId: string,
  conversationId: string
): Promise<void> {
  releaseConversationTranscript(transcriptWatchKey(projectId, taskId, conversationId));
}

function releaseConversationTranscript(key: string, listener?: TranscriptChangeListener): void {
  const entry = watches.get(key);
  if (!entry) return;
  if (listener) entry.listeners.delete(listener);
  entry.refs -= 1;
  if (entry.refs > 0) return;
  watches.delete(key);
  entry.stop();
}

/**
 * Resolves the CLI's own on-disk transcript for a conversation, honouring the
 * session source and runtime state root. Shared with the background-jobs reader,
 * which parses the same file.
 */
export async function resolveTranscriptPath(
  projectId: string,
  taskId: string,
  conversationId: string
): Promise<string | null> {
  const conversation = await loadConversation(conversationId);
  const cwd = resolveTask(projectId, taskId)?.conversations.taskPath;
  if (!conversation) return null;
  if (conversation.projectId !== projectId || conversation.taskId !== taskId) return null;

  if (conversation.runtimeId === 'claude') {
    const providerConfig = await runtimeOverrideSettings.getItem('claude');
    const stateRoot = getConversationRuntimeStateRoot(conversation, providerConfig);
    const sessionId = conversation.sessionSource?.sessionId ?? conversationId;
    if (conversation.sessionSource && stateRoot) {
      return (
        (await findClaudeTranscriptPathBySessionId(sessionId, stateRoot)) ??
        (cwd ? resolveClaudeTranscriptPathFromConfigDir(cwd, sessionId, stateRoot) : null)
      );
    }
    if (cwd) return resolveClaudeTranscriptPath(cwd, sessionId);
    return (await findClaudeTranscriptPathBySessionId(sessionId, stateRoot)) ?? null;
  }
  if (conversation.runtimeId === 'codex' && cwd) {
    const providerConfig = await runtimeOverrideSettings.getItem('codex');
    const stateRoot = getConversationRuntimeStateRoot(conversation, providerConfig);
    const reservedThreadIds = await getReservedCodexThreadIds(conversation.id);
    return await getCodexSessionRolloutPath(
      cwd,
      conversation.sessionSource?.sessionId ?? conversation.id,
      conversation.title,
      conversation.createdAt ?? null,
      {
        ...(stateRoot ? { codexHome: stateRoot } : {}),
        reservedThreadIds,
      }
    ).catch(() => null);
  }
  return null;
}

async function loadConversation(conversationId: string) {
  const [row] = await db
    .select()
    .from(conversations)
    .where(eq(conversations.id, conversationId))
    .limit(1);
  return row ? mapConversationRowToConversation(row) : null;
}
