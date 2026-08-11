import { existsSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { log } from '@main/lib/logger';
import { summarizeTitle } from './llm-summarizer';
import type {
  SessionBindingListener,
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
  rolloutPath?: string;
  tokensUsed?: number;
};

export type CodexThreadRef = {
  id: string;
  cwd: string;
  title?: string;
  firstUserMessage: string;
  createdAtMs: number;
  updatedAtMs: number;
};

export type CodexThreadRollout = {
  id: string;
  cwd: string;
  rolloutPath: string;
  createdAtMs: number;
  updatedAtMs: number;
};

const READY_POLL_INTERVAL_MS = 1_000;
const READY_POLL_MAX_MS = 5 * 60_000;
const RESUME_START_GRACE_MS = 10_000;
const NEW_SESSION_THREAD_CREATE_GRACE_MS = 1_000;
const NEW_SESSION_THREAD_CREATE_MAX_DRIFT_MS = 60_000;
const ROUTED_SESSION_SETTLE_MS = 10_000;
const MAX_INTERRUPTED_STUB_BYTES = 256 * 1024;
const TITLE_PREFIX_MATCH_MIN_LENGTH = 16;

const activeCodexThreadTitlePollers = new Set<CodexThreadTitlePoller>();
const claimedCodexThreadOwners = new Map<string, string>();
const claimedCodexThreadsByOwner = new Map<string, string>();

export function getClaimedCodexThreadId(conversationId: string): string | undefined {
  return claimedCodexThreadsByOwner.get(conversationId);
}

export class CodexSessionTitleSource implements SessionTitleSource {
  readonly runtimeId = 'codex' as const;

  watch(
    ctx: SessionTitleContext,
    onTitle: TitleListener,
    onSessionBound?: SessionBindingListener
  ): SessionTitleWatcher {
    const startedAtMs = ctx.startedAtMs ?? Date.now();
    return new CodexThreadTitlePoller({
      conversationId: ctx.conversationId,
      statePath: resolveCodexStatePath(ctx.stateRoot),
      cwd: ctx.cwd,
      startedAtMs,
      isResuming: ctx.isResuming ?? false,
      threadId: ctx.agentSessionId,
      onTitle,
      onSessionBound,
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
            NULLIF(rollout_path, '') AS rolloutPath,
            tokens_used AS tokensUsed,
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

export function findClosestCodexThreadRefByCreatedAt(params: {
  statePath: string;
  cwd: string;
  targetCreatedAtMs: number;
  maxDistanceMs: number;
  includeArchived?: boolean;
}): CodexThreadRef | undefined {
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
    return parseCodexThreadRef(row);
  });
}

export function findClosestCodexThreadRefByTitleAndCreatedAt(params: {
  statePath: string;
  title: string;
  targetCreatedAtMs: number;
  maxDistanceMs: number;
  includeArchived?: boolean;
}): CodexThreadRef | undefined {
  const title = params.title.trim();
  if (!title) return undefined;

  const minCreatedAtMs = params.targetCreatedAtMs - params.maxDistanceMs;
  const maxCreatedAtMs = params.targetCreatedAtMs + params.maxDistanceMs;
  return withCodexState(params.statePath, (db) => {
    const rows = db
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
          WHERE (? = 1 OR archived = 0)
            AND COALESCE(created_at_ms, created_at * 1000) >= ?
            AND COALESCE(created_at_ms, created_at * 1000) <= ?
            AND (
              title = ?
              OR first_user_message = ?
              OR preview = ?
              OR (
                ? = 1
                AND (
                  substr(title, 1, ?) = ?
                  OR substr(first_user_message, 1, ?) = ?
                  OR substr(preview, 1, ?) = ?
                )
              )
            )
          ORDER BY ABS(COALESCE(created_at_ms, created_at * 1000) - ?) ASC,
            COALESCE(created_at_ms, created_at * 1000) ASC,
            id ASC
          LIMIT 2
        `
      )
      .all(
        params.includeArchived ? 1 : 0,
        minCreatedAtMs,
        maxCreatedAtMs,
        title,
        title,
        title,
        title.length >= TITLE_PREFIX_MATCH_MIN_LENGTH ? 1 : 0,
        title.length,
        title,
        title.length,
        title,
        title.length,
        title,
        params.targetCreatedAtMs
      );
    if (!Array.isArray(rows) || rows.length !== 1) return undefined;
    return parseCodexThreadRef(rows[0]);
  });
}

export function findUniqueCodexThreadRefByCreatedAt(params: {
  statePath: string;
  targetCreatedAtMs: number;
  maxDistanceMs: number;
  includeArchived?: boolean;
}): CodexThreadRef | undefined {
  const minCreatedAtMs = params.targetCreatedAtMs - params.maxDistanceMs;
  const maxCreatedAtMs = params.targetCreatedAtMs + params.maxDistanceMs;
  return withCodexState(params.statePath, (db) => {
    const rows = db
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
          WHERE (? = 1 OR archived = 0)
            AND COALESCE(created_at_ms, created_at * 1000) >= ?
            AND COALESCE(created_at_ms, created_at * 1000) <= ?
          ORDER BY ABS(COALESCE(created_at_ms, created_at * 1000) - ?) ASC,
            COALESCE(created_at_ms, created_at * 1000) ASC,
            id ASC
          LIMIT 2
        `
      )
      .all(
        params.includeArchived ? 1 : 0,
        minCreatedAtMs,
        maxCreatedAtMs,
        params.targetCreatedAtMs
      );
    if (!Array.isArray(rows) || rows.length !== 1) return undefined;
    return parseCodexThreadRef(rows[0]);
  });
}

export function findUniqueUntitledCodexThreadRefByCwdAfterCreatedAt(params: {
  statePath: string;
  cwd: string;
  minCreatedAtMs: number;
  includeArchived?: boolean;
}): CodexThreadRef | undefined {
  return withCodexState(params.statePath, (db) => {
    const rows = db
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
            AND TRIM(COALESCE(title, '')) = ''
            AND TRIM(COALESCE(first_user_message, '')) = ''
            AND COALESCE(created_at_ms, created_at * 1000) >= ?
          ORDER BY COALESCE(created_at_ms, created_at * 1000) ASC, id ASC
          LIMIT 2
        `
      )
      .all(params.cwd, params.includeArchived ? 1 : 0, params.minCreatedAtMs);
    if (!Array.isArray(rows) || rows.length !== 1) return undefined;
    return parseCodexThreadRef(rows[0]);
  });
}

/**
 * Recovers a renamed legacy conversation from the one Codex thread that was
 * active when Yoda last interacted with it. This is deliberately stricter
 * than "closest timestamp": parallel threads in the same cwd stay ambiguous.
 */
export function findUniqueCodexThreadRefByCwdAtActivity(params: {
  statePath: string;
  cwd: string;
  activityAtMs: number;
  includeArchived?: boolean;
}): CodexThreadRef | undefined {
  return withCodexState(params.statePath, (db) => {
    const rows = db
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
            AND COALESCE(created_at_ms, created_at * 1000) <= ?
            AND COALESCE(updated_at_ms, updated_at * 1000) >= ?
          ORDER BY COALESCE(updated_at_ms, updated_at * 1000) DESC, id DESC
          LIMIT 2
        `
      )
      .all(params.cwd, params.includeArchived ? 1 : 0, params.activityAtMs, params.activityAtMs);
    if (!Array.isArray(rows) || rows.length !== 1) return undefined;
    return parseCodexThreadRef(rows[0]);
  });
}

export function findClosestCodexThreadRolloutByCreatedAt(params: {
  statePath: string;
  cwd: string;
  targetCreatedAtMs: number;
  maxDistanceMs: number;
  includeArchived?: boolean;
}): CodexThreadRollout | undefined {
  const minCreatedAtMs = params.targetCreatedAtMs - params.maxDistanceMs;
  const maxCreatedAtMs = params.targetCreatedAtMs + params.maxDistanceMs;
  return withCodexState(params.statePath, (db) => {
    const row = db
      .prepare(
        `
          SELECT
            id,
            cwd,
            NULLIF(rollout_path, '') AS rolloutPath,
            COALESCE(created_at_ms, created_at * 1000) AS createdAtMs,
            COALESCE(updated_at_ms, updated_at * 1000) AS updatedAtMs
          FROM threads
          WHERE cwd = ?
            AND (? = 1 OR archived = 0)
            AND NULLIF(rollout_path, '') IS NOT NULL
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
    return parseCodexThreadRollout(row);
  });
}

export function findNewCodexThreadRollout(params: {
  statePath: string;
  cwd: string;
  minCreatedAtMs: number;
  maxCreatedAtMs: number;
}): CodexThreadRollout | undefined {
  return withCodexState(params.statePath, (db) => {
    const row = db
      .prepare(
        `
          SELECT
            id,
            cwd,
            NULLIF(rollout_path, '') AS rolloutPath,
            COALESCE(created_at_ms, created_at * 1000) AS createdAtMs,
            COALESCE(updated_at_ms, updated_at * 1000) AS updatedAtMs
          FROM threads
          WHERE cwd = ?
            AND archived = 0
            AND NULLIF(rollout_path, '') IS NOT NULL
            AND COALESCE(created_at_ms, created_at * 1000) >= ?
            AND COALESCE(created_at_ms, created_at * 1000) <= ?
          ORDER BY COALESCE(created_at_ms, created_at * 1000) ASC, id ASC
          LIMIT 1
        `
      )
      .get(params.cwd, params.minCreatedAtMs, params.maxCreatedAtMs);
    return parseCodexThreadRollout(row);
  });
}

export function findRecentCodexThreadRollout(params: {
  statePath: string;
  cwd: string;
  minUpdatedAtMs: number;
}): CodexThreadRollout | undefined {
  return withCodexState(params.statePath, (db) => {
    const row = db
      .prepare(
        `
          SELECT
            id,
            cwd,
            NULLIF(rollout_path, '') AS rolloutPath,
            COALESCE(created_at_ms, created_at * 1000) AS createdAtMs,
            COALESCE(updated_at_ms, updated_at * 1000) AS updatedAtMs
          FROM threads
          WHERE cwd = ?
            AND archived = 0
            AND NULLIF(rollout_path, '') IS NOT NULL
            AND COALESCE(updated_at_ms, updated_at * 1000) >= ?
          ORDER BY COALESCE(updated_at_ms, updated_at * 1000) DESC, id DESC
          LIMIT 1
        `
      )
      .get(params.cwd, params.minUpdatedAtMs);
    return parseCodexThreadRollout(row);
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
            NULLIF(rollout_path, '') AS rolloutPath,
            tokens_used AS tokensUsed,
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

export function readCodexThreadRef(
  statePath: string,
  threadId: string
): CodexThreadRef | undefined {
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
    return parseCodexThreadRef(row);
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

/** Read many exact thread bindings through one readonly state DB handle. */
export function readCodexThreadRolloutPaths(
  statePath: string,
  threadIds: readonly string[]
): Map<string, string> {
  if (threadIds.length === 0) return new Map();
  return (
    withCodexState(statePath, (db) => {
      const statement = db.prepare(
        `
          SELECT NULLIF(rollout_path, '') AS rolloutPath
          FROM threads
          WHERE id = ?
          LIMIT 1
        `
      );
      const paths = new Map<string, string>();
      for (const threadId of new Set(threadIds)) {
        const row = statement.get(threadId);
        if (typeof row !== 'object' || row === null) continue;
        const value = (row as Record<string, unknown>).rolloutPath;
        if (typeof value === 'string' && value.length > 0) paths.set(threadId, value);
      }
      return paths;
    }) ?? new Map()
  );
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
  threadId?: string;
  onTitle: TitleListener;
  onSessionBound?: SessionBindingListener;
};

const summarizedThreadIds = new Set<string>();

class CodexThreadTitlePoller implements SessionTitleWatcher {
  private timer: NodeJS.Timeout | undefined;
  private readonly bindDeadline: number;
  private readonly minUpdatedAtMs: number;
  private threadId: string | undefined;
  private notifiedSessionId: string | undefined;
  private lastTitle: string | undefined;
  private stopped = false;

  constructor(private readonly options: CodexThreadTitlePollerOptions) {
    this.bindDeadline = options.startedAtMs + READY_POLL_MAX_MS;
    this.minUpdatedAtMs = options.startedAtMs - RESUME_START_GRACE_MS;
    activeCodexThreadTitlePollers.add(this);
    this.threadId = options.threadId;
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
      let row = this.threadId
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

      if (row && this.threadId === row.id) {
        row = this.findSupersedingThread(row) ?? row;
      }
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
      if (
        isRoutedPrompt(row.firstUserMessage) &&
        Date.now() < row.createdAtMs + ROUTED_SESSION_SETTLE_MS
      ) {
        return;
      }
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
    if (this.threadId === row.id) {
      this.notifySessionBound(row.id);
      return true;
    }

    const claimedBy = claimedCodexThreadOwners.get(row.id);
    if (claimedBy && claimedBy !== this.options.conversationId) return false;

    if (!this.options.isResuming && bestFreshOwnerFor(row) !== this) return false;

    claimedCodexThreadOwners.set(row.id, this.options.conversationId);
    claimedCodexThreadsByOwner.set(this.options.conversationId, row.id);
    this.threadId = row.id;
    this.notifySessionBound(row.id);
    return true;
  }

  private findSupersedingThread(current: CodexThreadTitle): CodexThreadTitle | undefined {
    if (this.options.isResuming || !isInterruptedCodexThreadStub(current)) return undefined;
    const candidate = findNewCodexThreadTitle({
      statePath: this.options.statePath,
      cwd: this.options.cwd,
      minCreatedAtMs: current.createdAtMs + 1,
      maxCreatedAtMs: this.maxCreatedAtMs,
    });
    if (
      !candidate ||
      !isLikelyRelaunchedPrompt(current.firstUserMessage, candidate.firstUserMessage)
    ) {
      return undefined;
    }

    const claimedBy = claimedCodexThreadOwners.get(candidate.id);
    if (claimedBy && claimedBy !== this.options.conversationId) return undefined;
    if (bestFreshOwnerFor(candidate)) return undefined;

    if (claimedCodexThreadOwners.get(current.id) === this.options.conversationId) {
      claimedCodexThreadOwners.delete(current.id);
    }
    claimedCodexThreadOwners.set(candidate.id, this.options.conversationId);
    claimedCodexThreadsByOwner.set(this.options.conversationId, candidate.id);
    this.threadId = candidate.id;
    this.notifySessionBound(candidate.id);
    return candidate;
  }

  private notifySessionBound(sessionId: string): void {
    if (this.notifiedSessionId === sessionId) return;
    this.notifiedSessionId = sessionId;
    try {
      this.options.onSessionBound?.(sessionId);
    } catch (error) {
      log.warn('CodexSessionTitleSource: session binding listener threw', {
        conversationId: this.options.conversationId,
        sessionId,
        error: String(error),
      });
    }
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
  const ref = parseCodexThreadRef(row);
  if (!ref?.title) return undefined;
  const rec = row as Record<string, unknown>;
  return {
    ...ref,
    title: ref.title,
    ...(typeof rec.rolloutPath === 'string' && rec.rolloutPath.length > 0
      ? { rolloutPath: rec.rolloutPath }
      : {}),
    ...(typeof rec.tokensUsed === 'number' ? { tokensUsed: rec.tokensUsed } : {}),
  };
}

function parseCodexThreadRef(row: unknown): CodexThreadRef | undefined {
  if (typeof row !== 'object' || row === null) return undefined;
  const rec = row as Record<string, unknown>;
  if (typeof rec.id !== 'string') return undefined;
  if (typeof rec.cwd !== 'string') return undefined;
  if (typeof rec.title !== 'string') return undefined;
  if (typeof rec.createdAtMs !== 'number') return undefined;
  if (typeof rec.updatedAtMs !== 'number') return undefined;
  const title = rec.title.trim();
  const firstUserMessage = typeof rec.firstUserMessage === 'string' ? rec.firstUserMessage : '';
  return {
    id: rec.id,
    cwd: rec.cwd,
    ...(title ? { title } : {}),
    firstUserMessage,
    createdAtMs: rec.createdAtMs,
    updatedAtMs: rec.updatedAtMs,
  };
}

function parseCodexThreadRollout(row: unknown): CodexThreadRollout | undefined {
  if (typeof row !== 'object' || row === null) return undefined;
  const rec = row as Record<string, unknown>;
  if (typeof rec.id !== 'string') return undefined;
  if (typeof rec.cwd !== 'string') return undefined;
  if (typeof rec.rolloutPath !== 'string' || rec.rolloutPath.length === 0) return undefined;
  if (typeof rec.createdAtMs !== 'number') return undefined;
  if (typeof rec.updatedAtMs !== 'number') return undefined;
  return {
    id: rec.id,
    cwd: rec.cwd,
    rolloutPath: rec.rolloutPath,
    createdAtMs: rec.createdAtMs,
    updatedAtMs: rec.updatedAtMs,
  };
}

function isInterruptedCodexThreadStub(thread: CodexThreadTitle): boolean {
  if (thread.tokensUsed !== 0 || !thread.rolloutPath || !existsSync(thread.rolloutPath))
    return false;
  try {
    if (statSync(thread.rolloutPath).size > MAX_INTERRUPTED_STUB_BYTES) return false;
    let interrupted = false;
    let substantiveResponse = false;
    for (const line of readFileSync(thread.rolloutPath, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      const record = JSON.parse(line) as {
        type?: string;
        payload?: { type?: string; role?: string; reason?: string };
      };
      if (
        record.type === 'event_msg' &&
        record.payload?.type === 'turn_aborted' &&
        record.payload.reason === 'interrupted'
      ) {
        interrupted = true;
      }
      if (record.type !== 'response_item') continue;
      if (record.payload?.type === 'message') {
        if (record.payload.role === 'assistant') substantiveResponse = true;
      } else {
        substantiveResponse = true;
      }
    }
    return interrupted && !substantiveResponse;
  } catch {
    return false;
  }
}

function isRoutedPrompt(prompt: string): boolean {
  return prompt.trimStart().startsWith('$');
}

function isLikelyRelaunchedPrompt(current: string, candidate: string): boolean {
  const currentPrompt = normalizePrompt(current);
  const candidatePrompt = normalizePrompt(candidate);
  if (!currentPrompt || !candidatePrompt) return false;
  if (currentPrompt === candidatePrompt) return true;
  if (!isRoutedPrompt(currentPrompt) || !isRoutedPrompt(candidatePrompt)) return false;

  const [currentCommand, ...currentBodyParts] = currentPrompt.split(' ');
  const [candidateCommand, ...candidateBodyParts] = candidatePrompt.split(' ');
  const currentBody = currentBodyParts.join(' ');
  const candidateBody = candidateBodyParts.join(' ');
  return (
    currentBody.length > 0 &&
    currentBody === candidateBody &&
    (candidateCommand.startsWith(currentCommand) || currentCommand.startsWith(candidateCommand))
  );
}

function normalizePrompt(prompt: string): string {
  return prompt.trim().replace(/\s+/g, ' ');
}
