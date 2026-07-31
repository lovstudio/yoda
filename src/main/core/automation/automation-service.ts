import { randomUUID } from 'node:crypto';
import { Cron } from 'croner';
import { and, asc, desc, eq, inArray, like, sql } from 'drizzle-orm';
import {
  automationCreateInputSchema,
  automationUpdateInputSchema,
  type Automation,
  type AutomationCreateInput,
  type AutomationRun,
  type AutomationRunStatus,
  type AutomationTriggerKind,
  type AutomationUpdateInput,
} from '@shared/automation';
import { automationRunsUpdatedChannel, automationsUpdatedChannel } from '@shared/events/appEvents';
import { isValidRuntimeId } from '@shared/runtime-registry';
import { appSettingsService } from '@main/core/settings/settings-service';
import { db } from '@main/db/client';
import { automationRuns, automations } from '@main/db/schema';
import { events } from '@main/lib/events';
import { log } from '@main/lib/logger';
import {
  CODEX_AUTOMATION_ID_PREFIX,
  readCodexAutomationSnapshots,
} from './codex-automation-source';

type AutomationRow = typeof automations.$inferSelect;
type AutomationRunRow = typeof automationRuns.$inferSelect;

function toAutomation(row: AutomationRow): Automation {
  return {
    id: row.id,
    source: row.id.startsWith(CODEX_AUTOMATION_ID_PREFIX) ? 'codex' : 'yoda',
    title: row.title,
    workspaceName: row.workspaceName,
    prompt: row.prompt,
    runtime: isValidRuntimeId(row.runtime) ? row.runtime : 'codex',
    scheduleLabel: row.scheduleLabel,
    status: row.status === 'paused' ? 'paused' : 'active',
    triggerKind: row.triggerKind === 'cron' ? 'cron' : 'manual',
    cronExpr: row.cronExpr,
    timezone: row.timezone,
    projectId: row.projectId,
    nextRunAt: row.nextRunAt,
    lastRunAt: row.lastRunAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toRun(row: AutomationRunRow): AutomationRun {
  return {
    id: row.id,
    automationId: row.automationId,
    taskId: row.taskId,
    trigger: row.trigger,
    status: row.status as AutomationRunStatus,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    error: row.error,
  };
}

/** Throws if the cron expression is invalid. */
function validateCron(cronExpr: string): void {
  // Throws on an invalid pattern; never schedules (paused).
  new Cron(cronExpr, { paused: true });
}

/** Next scheduled run (ISO) for a cron automation, or null when not applicable. */
export function computeNextRun(
  triggerKind: AutomationTriggerKind,
  cronExpr: string | null,
  timezone: string | null
): string | null {
  if (triggerKind !== 'cron' || !cronExpr) return null;
  try {
    const job = new Cron(cronExpr, timezone ? { timezone, paused: true } : { paused: true });
    const next = job.nextRun();
    return next ? next.toISOString() : null;
  } catch {
    return null;
  }
}

/**
 * Automations are stored in the `automations` table and their executions in
 * `automation_runs`. This service is the single source of truth; the renderer
 * reaches it only via RPC. Legacy entries that lived in
 * `app_settings['automations']` are migrated into the table once, on first read.
 */
export class AutomationService {
  private migration: Promise<void> | null = null;
  private runSweep: Promise<void> | null = null;
  private codexSync: Promise<boolean> | null = null;
  private codexSyncTimer: NodeJS.Timeout | null = null;
  private codexSyncErrors = new Set<string>();

  async initialize(): Promise<void> {
    await this.ensureMigrated();
    await this.syncCodexAutomations();
    if (this.codexSyncTimer) return;
    this.codexSyncTimer = setInterval(() => {
      void this.syncCodexAutomations();
    }, 60_000);
    this.codexSyncTimer.unref();
  }

  dispose(): void {
    if (this.codexSyncTimer) clearInterval(this.codexSyncTimer);
    this.codexSyncTimer = null;
  }

  /** Moves any legacy app_settings entries into the table exactly once. */
  private async ensureMigrated(): Promise<void> {
    this.migration ??= (async () => {
      const legacy = await appSettingsService.get('automations');
      const items = legacy?.items ?? [];
      if (items.length === 0) return;

      const existing = await db.select({ id: automations.id }).from(automations).limit(1);
      if (existing.length === 0) {
        await db.insert(automations).values(
          items.map((item, index) => ({
            id: item.id || randomUUID(),
            title: item.title,
            workspaceName: item.workspaceName,
            prompt: item.prompt,
            runtime: item.runtime,
            scheduleLabel: item.scheduleLabel ?? '',
            status: item.status === 'paused' ? 'paused' : 'active',
            sortOrder: index,
            lastRunAt: item.lastRunAt ?? null,
            createdAt: item.createdAt ?? new Date().toISOString(),
            updatedAt: item.updatedAt ?? new Date().toISOString(),
          }))
        );
        log.info('[automation] migrated legacy entries from settings', { count: items.length });
      }
      // Clear the legacy blob so we never re-migrate.
      await appSettingsService.update('automations', { items: [] });
    })().catch((error) => {
      log.warn('[automation] migration failed', { error: String(error) });
    });
    return this.migration;
  }

  /**
   * Reconciles every Codex file-backed automation into Yoda's automation table.
   * A deterministic ID makes the operation idempotent, while source
   * rows remain read-only in the renderer so the TOML file stays authoritative.
   */
  private async syncCodexAutomations(): Promise<boolean> {
    if (this.codexSync) return this.codexSync;
    this.codexSync = (async () => {
      const source = await readCodexAutomationSnapshots();
      const currentErrors = new Set(source.errors.map((item) => `${item.path}\0${item.message}`));
      for (const item of source.errors) {
        const key = `${item.path}\0${item.message}`;
        if (!this.codexSyncErrors.has(key)) {
          log.warn('[automation] failed to read Codex automation', item);
        }
      }
      this.codexSyncErrors = currentErrors;
      if (!source.available) return false;

      const existing = await db
        .select()
        .from(automations)
        .where(like(automations.id, `${CODEX_AUTOMATION_ID_PREFIX}%`));
      const existingById = new Map(existing.map((row) => [row.id, row]));
      let changed = false;

      for (const [index, item] of source.automations.entries()) {
        const row = existingById.get(item.id);
        const nextRunAt = computeNextRun(item.triggerKind, item.cronExpr, item.timezone);
        const values = {
          id: item.id,
          title: item.title,
          workspaceName: item.workspaceName,
          prompt: item.prompt,
          runtime: 'codex',
          scheduleLabel: item.scheduleLabel,
          status: item.status,
          triggerKind: item.triggerKind,
          cronExpr: item.cronExpr,
          timezone: item.timezone,
          projectId: null,
          sortOrder: -10_000 + index,
          createdAt: item.createdAt,
          updatedAt: item.updatedAt,
        } satisfies Partial<AutomationRow> & Pick<AutomationRow, 'id'>;

        if (!row) {
          await db.insert(automations).values({
            ...values,
            nextRunAt,
            lastRunAt: null,
          });
          changed = true;
          continue;
        }

        const isCurrent =
          row.title === values.title &&
          row.workspaceName === values.workspaceName &&
          row.prompt === values.prompt &&
          row.runtime === values.runtime &&
          row.scheduleLabel === values.scheduleLabel &&
          row.status === values.status &&
          row.triggerKind === values.triggerKind &&
          row.cronExpr === values.cronExpr &&
          row.timezone === values.timezone &&
          row.projectId === values.projectId &&
          row.sortOrder === values.sortOrder &&
          row.createdAt === values.createdAt &&
          row.updatedAt === values.updatedAt &&
          row.nextRunAt === nextRunAt;
        if (isCurrent) continue;

        await db
          .update(automations)
          .set({
            ...values,
            nextRunAt,
          })
          .where(eq(automations.id, item.id));
        changed = true;
      }

      const managedIds = new Set(source.managedIds);
      const staleIds = existing.filter((row) => !managedIds.has(row.id)).map((row) => row.id);
      if (staleIds.length > 0) {
        await db.delete(automations).where(inArray(automations.id, staleIds));
        changed = true;
      }

      if (changed) {
        log.info('[automation] synchronized Codex automations', {
          count: source.automations.length,
        });
        events.emit(automationsUpdatedChannel, undefined);
      }
      return changed;
    })().finally(() => {
      this.codexSync = null;
    });
    return this.codexSync;
  }

  async list(): Promise<Automation[]> {
    await this.ensureMigrated();
    await this.syncCodexAutomations();
    const rows = await db
      .select()
      .from(automations)
      .orderBy(asc(automations.sortOrder), asc(automations.createdAt));
    return rows.map(toAutomation);
  }

  async get(id: string): Promise<Automation | null> {
    await this.ensureMigrated();
    if (id.startsWith(CODEX_AUTOMATION_ID_PREFIX)) await this.syncCodexAutomations();
    const [row] = await db.select().from(automations).where(eq(automations.id, id)).limit(1);
    return row ? toAutomation(row) : null;
  }

  async create(input: AutomationCreateInput): Promise<Automation> {
    await this.ensureMigrated();
    const parsed = automationCreateInputSchema.parse(input);
    if (parsed.triggerKind === 'cron' && parsed.cronExpr) validateCron(parsed.cronExpr);
    const now = new Date().toISOString();
    // Prepend new entries (smallest sortOrder sorts first).
    const [{ next }] = await db
      .select({ next: sql<number>`coalesce(min(${automations.sortOrder}), 0) - 1` })
      .from(automations);
    const row = {
      id: randomUUID(),
      title: parsed.title,
      workspaceName: parsed.workspaceName,
      prompt: parsed.prompt,
      runtime: parsed.runtime,
      scheduleLabel: parsed.scheduleLabel,
      status: parsed.status,
      triggerKind: parsed.triggerKind,
      cronExpr: parsed.cronExpr,
      timezone: parsed.timezone,
      projectId: parsed.projectId,
      nextRunAt: computeNextRun(parsed.triggerKind, parsed.cronExpr, parsed.timezone),
      sortOrder: next ?? 0,
      lastRunAt: null,
      createdAt: now,
      updatedAt: now,
    };
    await db.insert(automations).values(row);
    events.emit(automationsUpdatedChannel, undefined);
    return toAutomation(row);
  }

  async update(id: string, patch: AutomationUpdateInput): Promise<Automation | null> {
    await this.ensureMigrated();
    if (id.startsWith(CODEX_AUTOMATION_ID_PREFIX)) return this.get(id);
    const parsed = automationUpdateInputSchema.parse(patch);
    const [existing] = await db.select().from(automations).where(eq(automations.id, id)).limit(1);
    if (!existing) return null;

    const set: Partial<AutomationRow> = { ...parsed };
    // Recompute cached nextRunAt whenever a trigger-relevant field changes.
    const touchesTrigger = 'triggerKind' in parsed || 'cronExpr' in parsed || 'timezone' in parsed;
    if (touchesTrigger) {
      const triggerKind = (parsed.triggerKind ?? existing.triggerKind) as AutomationTriggerKind;
      const cronExpr = 'cronExpr' in parsed ? (parsed.cronExpr ?? null) : existing.cronExpr;
      const timezone = 'timezone' in parsed ? (parsed.timezone ?? null) : existing.timezone;
      if (triggerKind === 'cron' && cronExpr) validateCron(cronExpr);
      set.nextRunAt = computeNextRun(triggerKind, cronExpr, timezone);
    }

    if (Object.keys(set).length > 0) {
      await db.update(automations).set(set).where(eq(automations.id, id));
    }
    events.emit(automationsUpdatedChannel, undefined);
    const [row] = await db.select().from(automations).where(eq(automations.id, id)).limit(1);
    return row ? toAutomation(row) : null;
  }

  async remove(id: string): Promise<void> {
    await this.ensureMigrated();
    if (id.startsWith(CODEX_AUTOMATION_ID_PREFIX)) {
      await this.syncCodexAutomations();
      return;
    }
    await db.delete(automations).where(eq(automations.id, id));
    events.emit(automationsUpdatedChannel, undefined);
  }

  /** Updates the cached next-run timestamp without emitting a CRUD event. */
  async setNextRunAt(id: string, nextRunAt: string | null): Promise<void> {
    await db.update(automations).set({ nextRunAt }).where(eq(automations.id, id));
  }

  async setLastRunAt(id: string, lastRunAt: string): Promise<void> {
    await db.update(automations).set({ lastRunAt }).where(eq(automations.id, id));
  }

  // ---- run records ----------------------------------------------------------

  async hasRunningRun(automationId: string): Promise<boolean> {
    const rows = await db
      .select({ id: automationRuns.id })
      .from(automationRuns)
      .where(
        and(eq(automationRuns.automationId, automationId), eq(automationRuns.status, 'running'))
      )
      .limit(1);
    return rows.length > 0;
  }

  async startRun(automationId: string, trigger: string, taskId?: string): Promise<string> {
    const id = randomUUID();
    await db.insert(automationRuns).values({
      id,
      automationId,
      taskId: taskId ?? null,
      trigger,
      status: 'running',
      startedAt: new Date().toISOString(),
    });
    events.emit(automationRunsUpdatedChannel, undefined);
    return id;
  }

  async finishRun(
    runId: string,
    status: Exclude<AutomationRunStatus, 'running'>,
    error?: string | null
  ): Promise<void> {
    const finished = await db
      .update(automationRuns)
      .set({ status, error: error ?? null, finishedAt: new Date().toISOString() })
      .where(and(eq(automationRuns.id, runId), eq(automationRuns.status, 'running')))
      .returning({ id: automationRuns.id });
    if (finished.length > 0) events.emit(automationRunsUpdatedChannel, undefined);
  }

  /**
   * Completes whichever persisted automation run owns this task. Event
   * correlation must not depend on an in-memory map: main-process HMR and fast
   * task completion can otherwise leave the database row permanently running.
   */
  async finishRunningRunForTask(
    taskId: string,
    status: Exclude<AutomationRunStatus, 'running'>,
    error?: string | null
  ): Promise<void> {
    const finished = await db
      .update(automationRuns)
      .set({ status, error: error ?? null, finishedAt: new Date().toISOString() })
      .where(and(eq(automationRuns.taskId, taskId), eq(automationRuns.status, 'running')))
      .returning({ id: automationRuns.id });
    if (finished.length > 0) events.emit(automationRunsUpdatedChannel, undefined);
  }

  async listRuns(automationId?: string, limit = 50): Promise<AutomationRun[]> {
    await this.ensureMigrated();
    const rows = await db
      .select()
      .from(automationRuns)
      .where(automationId ? eq(automationRuns.automationId, automationId) : undefined)
      .orderBy(desc(automationRuns.startedAt))
      .limit(Math.min(500, Math.max(1, limit)));
    return rows.map(toRun);
  }

  /** Marks runs left `running` by a previous process as interrupted. Runs once. */
  async sweepInterruptedRuns(): Promise<void> {
    this.runSweep ??= (async () => {
      const interrupted = await db
        .update(automationRuns)
        .set({
          status: 'failed',
          error: 'Interrupted: the app quit before this run finished.',
          finishedAt: new Date().toISOString(),
        })
        .where(eq(automationRuns.status, 'running'))
        .returning({ id: automationRuns.id });
      if (interrupted.length > 0) {
        events.emit(automationRunsUpdatedChannel, undefined);
      }
    })().catch((error) => {
      log.warn('[automation] run sweep failed', { error: String(error) });
    });
    return this.runSweep;
  }
}

export const automationService = new AutomationService();
