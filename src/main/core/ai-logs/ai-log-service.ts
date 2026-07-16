import { randomUUID } from 'node:crypto';
import { and, desc, eq, inArray } from 'drizzle-orm';
import type {
  AiInvocationLogRecord,
  AiLogListInput,
  AiLogMode,
  AiLogStatus,
} from '@shared/ai-logs';
import { aiLogUpdatedChannel } from '@shared/events/appEvents';
import { db } from '@main/db/client';
import { aiInvocationLogs } from '@main/db/schema';
import { events } from '@main/lib/events';
import { log } from '@main/lib/logger';

const MAX_PROMPT_CHARS = 16_000;
const MAX_OUTPUT_CHARS = 8_000;
const MAX_ERROR_CHARS = 4_000;
const MAX_ROWS = 1_000;
const DEFAULT_LIST_LIMIT = 200;

type LogRow = typeof aiInvocationLogs.$inferSelect;

export type AiLogStartInput = {
  purpose: string;
  mode: AiLogMode;
  runtime: string;
  model?: string | null;
  command?: string | null;
  prompt?: string | null;
  metadata?: Record<string, string>;
};

export type AiLogFinishInput = {
  status: Exclude<AiLogStatus, 'running'>;
  output?: string | null;
  error?: string | null;
};

function clip(value: string | null | undefined, max: number): string | null {
  if (!value) return null;
  return value.length <= max
    ? value
    : `${value.slice(0, max)}\n… [clipped ${value.length - max} chars]`;
}

function toRecord(row: LogRow): AiInvocationLogRecord {
  return {
    id: row.id,
    purpose: row.purpose,
    mode: row.mode as AiLogMode,
    runtime: row.runtime,
    model: row.model,
    command: row.command,
    prompt: row.prompt,
    output: row.output,
    status: row.status as AiLogStatus,
    error: row.error,
    metadata: row.metadata ?? null,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    durationMs: row.durationMs,
  };
}

/**
 * Persistent audit log for every AI invocation the app makes on the user's
 * behalf — non-interactive CLI spawns (naming, summary, logo generation, …),
 * direct API calls (ZenMux/MaaS), and interactive agent sessions. A row is
 * written when the work STARTS (status `running`) so slow background jobs are
 * visible while they run, then updated on completion.
 *
 * Logging must never break the work it observes: every method swallows its
 * own failures.
 */
export class AiLogService {
  /** Marks rows left `running` by a previous process as interrupted. */
  private startupSweep: Promise<void> | null = null;

  private async ensureStartupSweep(): Promise<void> {
    this.startupSweep ??= (async () => {
      const stale = await db
        .select({ id: aiInvocationLogs.id })
        .from(aiInvocationLogs)
        .where(eq(aiInvocationLogs.status, 'running'));
      if (stale.length === 0) return;
      await db
        .update(aiInvocationLogs)
        .set({
          status: 'failed',
          error: 'Interrupted: the app quit before this invocation finished.',
          finishedAt: new Date().toISOString(),
        })
        .where(eq(aiInvocationLogs.status, 'running'));
    })().catch((error) => {
      log.warn('[ai-log] startup sweep failed', { error: String(error) });
    });
    return this.startupSweep;
  }

  /** Inserts a `running` row and returns its id. Never throws. */
  async start(input: AiLogStartInput): Promise<string> {
    const id = randomUUID();
    try {
      await this.ensureStartupSweep();
      await db.insert(aiInvocationLogs).values({
        id,
        purpose: input.purpose,
        mode: input.mode,
        runtime: input.runtime,
        model: input.model ?? null,
        command: clip(input.command, MAX_OUTPUT_CHARS),
        prompt: clip(input.prompt, MAX_PROMPT_CHARS),
        output: null,
        status: 'running',
        error: null,
        metadata: input.metadata ?? null,
        startedAt: new Date().toISOString(),
        finishedAt: null,
        durationMs: null,
      });
      await this.trim();
      events.emit(aiLogUpdatedChannel, { id });
    } catch (error) {
      log.warn('[ai-log] failed to record invocation start', { error: String(error) });
    }
    return id;
  }

  /** Marks a row finished. Never throws. */
  async finish(id: string, input: AiLogFinishInput): Promise<void> {
    try {
      const [row] = await db
        .select({ startedAt: aiInvocationLogs.startedAt })
        .from(aiInvocationLogs)
        .where(eq(aiInvocationLogs.id, id))
        .limit(1);
      if (!row) return;
      const finishedAt = new Date();
      await db
        .update(aiInvocationLogs)
        .set({
          status: input.status,
          output: clip(input.output, MAX_OUTPUT_CHARS),
          error: clip(input.error, MAX_ERROR_CHARS),
          finishedAt: finishedAt.toISOString(),
          durationMs: Math.max(0, finishedAt.getTime() - new Date(row.startedAt).getTime()),
        })
        .where(eq(aiInvocationLogs.id, id));
      events.emit(aiLogUpdatedChannel, { id });
    } catch (error) {
      log.warn('[ai-log] failed to record invocation finish', { error: String(error) });
    }
  }

  async list(input: AiLogListInput = {}): Promise<AiInvocationLogRecord[]> {
    await this.ensureStartupSweep();
    const limit = Math.min(500, Math.max(1, input.limit ?? DEFAULT_LIST_LIMIT));
    const conditions = [];
    if (input.status) conditions.push(eq(aiInvocationLogs.status, input.status));
    if (input.mode) conditions.push(eq(aiInvocationLogs.mode, input.mode));
    if (input.runtime) conditions.push(eq(aiInvocationLogs.runtime, input.runtime));
    const hasMetadataFilter = Boolean(
      input.conversationId || input.authProvider || input.maasPlatformId
    );
    const rows = await db
      .select()
      .from(aiInvocationLogs)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(aiInvocationLogs.startedAt))
      .limit(hasMetadataFilter ? MAX_ROWS : limit);
    const records = rows.map(toRecord);
    if (!hasMetadataFilter) return records;
    return records
      .filter((record) => {
        if (input.conversationId && record.metadata?.conversationId !== input.conversationId) {
          return false;
        }
        if (input.authProvider && record.metadata?.authProvider !== input.authProvider)
          return false;
        if (input.maasPlatformId && record.metadata?.maasPlatformId !== input.maasPlatformId) {
          return false;
        }
        return true;
      })
      .slice(0, limit);
  }

  async clear(): Promise<void> {
    await db.delete(aiInvocationLogs);
    events.emit(aiLogUpdatedChannel, { id: '' });
  }

  /** Keeps the table bounded; oldest rows are dropped past MAX_ROWS. */
  private async trim(): Promise<void> {
    const overflow = await db
      .select({ id: aiInvocationLogs.id })
      .from(aiInvocationLogs)
      .orderBy(desc(aiInvocationLogs.startedAt))
      .limit(1_000_000)
      .offset(MAX_ROWS);
    if (overflow.length === 0) return;
    await db.delete(aiInvocationLogs).where(
      inArray(
        aiInvocationLogs.id,
        overflow.map((row) => row.id)
      )
    );
  }
}

export const aiLogService = new AiLogService();
