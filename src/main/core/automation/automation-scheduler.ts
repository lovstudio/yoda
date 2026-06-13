import { Cron } from 'croner';
import { automationsUpdatedChannel } from '@shared/events/appEvents';
import { events } from '@main/lib/events';
import { log } from '@main/lib/logger';
import { automationRunner } from './automation-runner';
import { automationService } from './automation-service';

/**
 * In-process cron scheduler (croner). SQLite owns the schedules; on boot and on
 * every CRUD change this rebuilds the live Cron timers from the table and caches
 * each automation's nextRunAt for the UI. Missed runs (app was closed) are NOT
 * back-fired — the schedule simply advances forward.
 */
export class AutomationScheduler {
  private jobs = new Map<string, Cron>();
  private initialized = false;
  private reloading = false;

  async initialize(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
    automationRunner.initialize();
    await automationService.sweepInterruptedRuns();
    await this.reload();
    // Rebuild whenever automations change (CRUD). Run-state events use a
    // separate channel and intentionally do NOT trigger a rebuild.
    events.on(automationsUpdatedChannel, () => {
      void this.reload();
    });
  }

  private clear(): void {
    for (const job of this.jobs.values()) job.stop();
    this.jobs.clear();
  }

  async reload(): Promise<void> {
    if (this.reloading) return;
    this.reloading = true;
    try {
      this.clear();
      const list = await automationService.list();
      for (const auto of list) {
        if (auto.status !== 'active' || auto.triggerKind !== 'cron' || !auto.cronExpr) continue;
        try {
          const job = new Cron(
            auto.cronExpr,
            auto.timezone ? { timezone: auto.timezone } : {},
            () => {
              void this.onTick(auto.id);
            }
          );
          this.jobs.set(auto.id, job);
          const next = job.nextRun();
          await automationService.setNextRunAt(auto.id, next ? next.toISOString() : null);
        } catch (error) {
          log.warn('[automation] invalid cron, skipping', {
            id: auto.id,
            cron: auto.cronExpr,
            error: String(error),
          });
          await automationService.setNextRunAt(auto.id, null);
        }
      }
    } finally {
      this.reloading = false;
    }
  }

  private async onTick(automationId: string): Promise<void> {
    // Advance the cached next-run before firing so the UI reflects it.
    const job = this.jobs.get(automationId);
    if (job) {
      const next = job.nextRun();
      await automationService.setNextRunAt(automationId, next ? next.toISOString() : null);
    }
    await automationRunner.fire(automationId, 'cron');
  }
}

export const automationScheduler = new AutomationScheduler();
