import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { log } from '@main/lib/logger';
import { summarizeTitle } from './llm-summarizer';
import type {
  SessionTitleContext,
  SessionTitleSource,
  SessionTitleWatcher,
  TitleListener,
} from './types';

export type CodexThreadTitle = {
  id: string;
  cwd: string;
  title: string;
  firstUserMessage: string;
  createdAtMs: number;
  updatedAtMs: number;
};

const READY_POLL_INTERVAL_MS = 1_000;
const READY_POLL_MAX_MS = 5 * 60_000;
const RESUME_START_GRACE_MS = 10_000;
const NEW_SESSION_THREAD_CREATE_GRACE_MS = 1_000;
const NEW_SESSION_THREAD_CREATE_MAX_DRIFT_MS = 60_000;

const activeCodexThreadTitlePollers = new Set<CodexThreadTitlePoller>();
const claimedCodexThreadOwners = new Map<string, string>();
const claimedCodexThreadsByOwner = new Map<string, string>();

export function getClaimedCodexThreadId(conversationId: string): string | undefined {
  return claimedCodexThreadsByOwner.get(conversationId);
}

export class CodexSessionTitleSource implements SessionTitleSource {
  readonly providerId = 'codex' as const;

  watch(ctx: SessionTitleContext, onTitle: TitleListener): SessionTitleWatcher {
    const startedAtMs = ctx.startedAtMs ?? Date.now();
    return new CodexThreadTitlePoller({
      conversationId: ctx.conversationId,
      statePath: resolveCodexStatePath(),
      cwd: ctx.cwd,
      startedAtMs,
      isResuming: ctx.isResuming ?? false,
      onTitle,
    });
  }
}

export function findNewCodexThreadTitle(params: {
  statePath: string;
  cwd: string;
  minCreatedAtMs: number;
  maxCreatedAtMs: number;
}): CodexThreadTitle | undefined {
  return withCodexState(params.statePath, (db) => {
    const row = db
      .prepare(
        `
          SELECT
            id,
            cwd,
            title,
            first_user_message AS firstUserMessage,
            COALESCE(created_at_ms, created_at * 1000) AS createdAtMs,
            COALESCE(updated_at_ms, updated_at * 1000) AS updatedAtMs
          FROM threads
          WHERE cwd = ?
            AND archived = 0
            AND COALESCE(created_at_ms, created_at * 1000) >= ?
            AND COALESCE(created_at_ms, created_at * 1000) <= ?
          ORDER BY COALESCE(created_at_ms, created_at * 1000) ASC, id ASC
          LIMIT 1
        `
      )
      .get(params.cwd, params.minCreatedAtMs, params.maxCreatedAtMs);
    return parseCodexThreadTitle(row);
  });
}

export function resolveCodexStatePath(
  codexHome = process.env.CODEX_HOME ?? join(homedir(), '.codex')
): string {
  return join(codexHome, 'state_5.sqlite');
}

export function findRecentCodexThreadTitle(params: {
  statePath: string;
  cwd: string;
  minUpdatedAtMs: number;
}): CodexThreadTitle | undefined {
  return withCodexState(params.statePath, (db) => {
    const row = db
      .prepare(
        `
          SELECT
            id,
            cwd,
            title,
            first_user_message AS firstUserMessage,
            COALESCE(created_at_ms, created_at * 1000) AS createdAtMs,
            COALESCE(updated_at_ms, updated_at * 1000) AS updatedAtMs
          FROM threads
          WHERE cwd = ?
            AND archived = 0
            AND COALESCE(updated_at_ms, updated_at * 1000) >= ?
          ORDER BY COALESCE(updated_at_ms, updated_at * 1000) DESC, id DESC
          LIMIT 1
        `
      )
      .get(params.cwd, params.minUpdatedAtMs);
    return parseCodexThreadTitle(row);
  });
}

export function findCodexThreadTitleByTitle(params: {
  statePath: string;
  cwd: string;
  title: string;
  includeArchived?: boolean;
}): CodexThreadTitle | undefined {
  return withCodexState(params.statePath, (db) => {
    const row = db
      .prepare(
        `
          SELECT
            id,
            cwd,
            title,
            first_user_message AS firstUserMessage,
            COALESCE(created_at_ms, created_at * 1000) AS createdAtMs,
            COALESCE(updated_at_ms, updated_at * 1000) AS updatedAtMs
          FROM threads
          WHERE cwd = ?
            AND (? = 1 OR archived = 0)
            AND (
              title = ?
              OR first_user_message = ?
              OR preview = ?
            )
          ORDER BY COALESCE(updated_at_ms, updated_at * 1000) DESC, id DESC
          LIMIT 1
        `
      )
      .get(params.cwd, params.includeArchived ? 1 : 0, params.title, params.title, params.title);
    return parseCodexThreadTitle(row);
  });
}

export function findClosestCodexThreadTitleByCreatedAt(params: {
  statePath: string;
  cwd: string;
  targetCreatedAtMs: number;
  maxDistanceMs: number;
  includeArchived?: boolean;
}): CodexThreadTitle | undefined {
  const minCreatedAtMs = params.targetCreatedAtMs - params.maxDistanceMs;
  const maxCreatedAtMs = params.targetCreatedAtMs + params.maxDistanceMs;
  return withCodexState(params.statePath, (db) => {
    const row = db
      .prepare(
        `
          SELECT
            id,
            cwd,
            title,
            first_user_message AS firstUserMessage,
            COALESCE(created_at_ms, created_at * 1000) AS createdAtMs,
            COALESCE(updated_at_ms, updated_at * 1000) AS updatedAtMs
          FROM threads
          WHERE cwd = ?
            AND (? = 1 OR archived = 0)
            AND COALESCE(created_at_ms, created_at * 1000) >= ?
            AND COALESCE(created_at_ms, created_at * 1000) <= ?
          ORDER BY ABS(COALESCE(created_at_ms, created_at * 1000) - ?) ASC,
            COALESCE(created_at_ms, created_at * 1000) ASC,
            id ASC
          LIMIT 1
        `
      )
      .get(
        params.cwd,
        params.includeArchived ? 1 : 0,
        minCreatedAtMs,
        maxCreatedAtMs,
        params.targetCreatedAtMs
      );
    return parseCodexThreadTitle(row);
  });
}

export function readCodexThreadTitle(
  statePath: string,
  threadId: string
): CodexThreadTitle | undefined {
  return withCodexState(statePath, (db) => {
    const row = db
      .prepare(
        `
          SELECT
            id,
            cwd,
            title,
            first_user_message AS firstUserMessage,
            COALESCE(created_at_ms, created_at * 1000) AS createdAtMs,
            COALESCE(updated_at_ms, updated_at * 1000) AS updatedAtMs
          FROM threads
          WHERE id = ?
          LIMIT 1
        `
      )
      .get(threadId);
    return parseCodexThreadTitle(row);
  });
}

export function readCodexThreadRolloutPath(
  statePath: string,
  threadId: string
): string | undefined {
  return withCodexState(statePath, (db) => {
    const row = db
      .prepare(
        `
          SELECT NULLIF(rollout_path, '') AS rolloutPath
          FROM threads
          WHERE id = ?
          LIMIT 1
        `
      )
      .get(threadId);
    if (typeof row !== 'object' || row === null) return undefined;
    const value = (row as Record<string, unknown>).rolloutPath;
    return typeof value === 'string' && value.length > 0 ? value : undefined;
  });
}

export function readCodexThreadArchiveStatus(
  statePath: string,
  threadId: string
): boolean | undefined {
  return withCodexState(statePath, (db) => {
    const row = db
      .prepare(
        `
          SELECT archived
          FROM threads
          WHERE id = ?
          LIMIT 1
        `
      )
      .get(threadId);
    if (typeof row !== 'object' || row === null) return undefined;
    const archived = (row as Record<string, unknown>).archived;
    if (archived === true || archived === 1) return true;
    if (archived === false || archived === 0) return false;
    return undefined;
  });
}

type CodexThreadTitlePollerOptions = {
  conversationId: string;
  statePath: string;
  cwd: string;
  startedAtMs: number;
  isResuming: boolean;
  onTitle: TitleListener;
};

const summarizedThreadIds = new Set<string>();

class CodexThreadTitlePoller implements SessionTitleWatcher {
  private timer: NodeJS.Timeout | undefined;
  private readonly bindDeadline: number;
  private readonly minUpdatedAtMs: number;
  private threadId: string | undefined;
  private lastTitle: string | undefined;
  private stopped = false;

  constructor(private readonly options: CodexThreadTitlePollerOptions) {
    this.bindDeadline = options.startedAtMs + READY_POLL_MAX_MS;
    this.minUpdatedAtMs = options.startedAtMs - RESUME_START_GRACE_MS;
    activeCodexThreadTitlePollers.add(this);
    this.schedule(0);
  }

  stop(): void {
    this.stopped = true;
    activeCodexThreadTitlePollers.delete(this);
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }

  private schedule(delayMs: number): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => this.poll(), delayMs);
  }

  private poll(): void {
    if (this.stopped) return;
    try {
      const row = this.threadId
        ? readCodexThreadTitle(this.options.statePath, this.threadId)
        : this.options.isResuming
          ? findRecentCodexThreadTitle({
              statePath: this.options.statePath,
              cwd: this.options.cwd,
              minUpdatedAtMs: this.minUpdatedAtMs,
            })
          : findNewCodexThreadTitle({
              statePath: this.options.statePath,
              cwd: this.options.cwd,
              minCreatedAtMs: this.minCreatedAtMs,
              maxCreatedAtMs: this.maxCreatedAtMs,
            });

      if (row && this.tryBindThread(row)) {
        this.handleRow(row);
      }
    } catch (error) {
      log.warn('CodexSessionTitleSource: poll failed', {
        statePath: this.options.statePath,
        error: String(error),
      });
    }

    if (this.threadId || Date.now() <= this.bindDeadline) {
      this.schedule(READY_POLL_INTERVAL_MS);
    }
  }

  private handleRow(row: CodexThreadTitle): void {
    const isUnrenamed = row.firstUserMessage.length > 0 && row.title === row.firstUserMessage;
    if (isUnrenamed) {
      this.maybeSummarize(row);
      return;
    }
    this.emitIfChanged(row.title);
  }

  private maybeSummarize(row: CodexThreadTitle): void {
    if (summarizedThreadIds.has(row.id)) {
      this.stop();
      return;
    }
    summarizedThreadIds.add(row.id);
    void summarizeTitle(row.firstUserMessage)
      .then((title) => {
        if (this.stopped) return;
        if (!title) {
          this.stop();
          return;
        }
        this.emitIfChanged(title);
      })
      .catch((error) => {
        log.warn('CodexSessionTitleSource: summarize failed', {
          threadId: row.id,
          error: String(error),
        });
      })
      .finally(() => {
        this.stop();
      });
  }

  private emitIfChanged(title: string): void {
    if (!title || title === this.lastTitle) return;
    this.lastTitle = title;
    try {
      this.options.onTitle(title);
    } catch (error) {
      log.warn('CodexSessionTitleSource: listener threw', { error: String(error) });
    } finally {
      this.stop();
    }
  }

  private get minCreatedAtMs(): number {
    return this.options.startedAtMs - NEW_SESSION_THREAD_CREATE_GRACE_MS;
  }

  private get maxCreatedAtMs(): number {
    return this.options.startedAtMs + NEW_SESSION_THREAD_CREATE_MAX_DRIFT_MS;
  }

  isFreshCandidateOwnerFor(row: CodexThreadTitle): boolean {
    return (
      !this.stopped &&
      !this.threadId &&
      !this.options.isResuming &&
      this.options.cwd === row.cwd &&
      row.createdAtMs >= this.minCreatedAtMs &&
      row.createdAtMs <= this.maxCreatedAtMs
    );
  }

  freshOwnershipDistance(row: CodexThreadTitle): number {
    return Math.abs(row.createdAtMs - this.options.startedAtMs);
  }

  freshStartedAtMs(): number {
    return this.options.startedAtMs;
  }

  private tryBindThread(row: CodexThreadTitle): boolean {
    if (this.threadId === row.id) return true;

    const claimedBy = claimedCodexThreadOwners.get(row.id);
    if (claimedBy && claimedBy !== this.options.conversationId) return false;

    if (!this.options.isResuming && bestFreshOwnerFor(row) !== this) return false;

    claimedCodexThreadOwners.set(row.id, this.options.conversationId);
    claimedCodexThreadsByOwner.set(this.options.conversationId, row.id);
    this.threadId = row.id;
    return true;
  }
}

function bestFreshOwnerFor(row: CodexThreadTitle): CodexThreadTitlePoller | undefined {
  return Array.from(activeCodexThreadTitlePollers)
    .filter((poller) => poller.isFreshCandidateOwnerFor(row))
    .sort(
      (a, b) =>
        a.freshOwnershipDistance(row) - b.freshOwnershipDistance(row) ||
        b.freshStartedAtMs() - a.freshStartedAtMs()
    )[0];
}

function withCodexState<T>(statePath: string, fn: (db: Database.Database) => T): T | undefined {
  if (!existsSync(statePath)) return undefined;
  const db = new Database(statePath, { readonly: true, fileMustExist: true });
  try {
    db.pragma('query_only = ON');
    return fn(db);
  } catch (error) {
    if (isExpectedUnavailableCodexStateError(error)) return undefined;
    throw error;
  } finally {
    db.close();
  }
}

function isExpectedUnavailableCodexStateError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return (
    error.message.includes('no such table: threads') ||
    error.message.includes('unable to open database file')
  );
}

function parseCodexThreadTitle(row: unknown): CodexThreadTitle | undefined {
  if (typeof row !== 'object' || row === null) return undefined;
  const rec = row as Record<string, unknown>;
  if (typeof rec.id !== 'string') return undefined;
  if (typeof rec.cwd !== 'string') return undefined;
  if (typeof rec.title !== 'string') return undefined;
  if (typeof rec.createdAtMs !== 'number') return undefined;
  if (typeof rec.updatedAtMs !== 'number') return undefined;
  const title = rec.title.trim();
  if (!title) return undefined;
  const firstUserMessage = typeof rec.firstUserMessage === 'string' ? rec.firstUserMessage : '';
  return {
    id: rec.id,
    cwd: rec.cwd,
    title,
    firstUserMessage,
    createdAtMs: rec.createdAtMs,
    updatedAtMs: rec.updatedAtMs,
  };
}
