import { randomUUID } from 'node:crypto';
import { Cron } from 'croner';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
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

type AutomationRow = typeof automations.$inferSelect;
type AutomationRunRow = typeof automationRuns.$inferSelect;

function toAutomation(row: AutomationRow): Automation {
  return {
    id: row.id,
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

  async list(): Promise<Automation[]> {
    await this.ensureMigrated();
    const rows = await db
      .select()
      .from(automations)
      .orderBy(asc(automations.sortOrder), asc(automations.createdAt));
    return rows.map(toAutomation);
  }

  async get(id: string): Promise<Automation | null> {
    await this.ensureMigrated();
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

  async startRun(automationId: string, trigger: string): Promise<string> {
    const id = randomUUID();
    await db.insert(automationRuns).values({
      id,
      automationId,
      taskId: null,
      trigger,
      status: 'running',
      startedAt: new Date().toISOString(),
    });
    events.emit(automationRunsUpdatedChannel, undefined);
    return id;
  }

  async setRunTask(runId: string, taskId: string): Promise<void> {
    await db.update(automationRuns).set({ taskId }).where(eq(automationRuns.id, runId));
    events.emit(automationRunsUpdatedChannel, undefined);
  }

  async finishRun(
    runId: string,
    status: Exclude<AutomationRunStatus, 'running'>,
    error?: string | null
  ): Promise<void> {
    await db
      .update(automationRuns)
      .set({ status, error: error ?? null, finishedAt: new Date().toISOString() })
      .where(eq(automationRuns.id, runId));
    events.emit(automationRunsUpdatedChannel, undefined);
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
      await db
        .update(automationRuns)
        .set({
          status: 'failed',
          error: 'Interrupted: the app quit before this run finished.',
          finishedAt: new Date().toISOString(),
        })
        .where(eq(automationRuns.status, 'running'));
    })().catch((error) => {
      log.warn('[automation] run sweep failed', { error: String(error) });
    });
    return this.runSweep;
  }
}

export const automationService = new AutomationService();
