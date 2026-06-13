import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import {
  agentSessionExitedChannel,
  agentSessionStatusChangedChannel,
} from '@shared/events/agentEvents';
import { INTERNAL_PROJECT_ID } from '@shared/projects';
import { ensureUniqueTaskSlug, taskNameFromPrompt } from '@shared/task-name';
import { createTask } from '@main/core/tasks/operations/createTask';
import { db } from '@main/db/client';
import { tasks } from '@main/db/schema';
import { events } from '@main/lib/events';
import { log } from '@main/lib/logger';
import { automationService } from './automation-service';

/**
 * Executes automations as agent tasks. P1 runs everything in the internal
 * Drafts workspace (no worktree), identical to the manual "Run" path; running
 * in a real project on a new branch is a follow-up (P1b).
 *
 * Completion is tracked by correlating agent session events back to the run via
 * taskId — the first `completed`/`error` status (or PTY exit) ends the run.
 */
export class AutomationRunner {
  private initialized = false;
  /** taskId → runId for in-flight runs. */
  private active = new Map<string, string>();

  initialize(): void {
    if (this.initialized) return;
    this.initialized = true;

    events.on(agentSessionStatusChangedChannel, (e) => {
      const runId = this.active.get(e.taskId);
      if (!runId) return;
      if (e.status === 'completed') {
        this.active.delete(e.taskId);
        void automationService.finishRun(runId, 'success');
      } else if (e.status === 'error') {
        this.active.delete(e.taskId);
        void automationService.finishRun(runId, 'failed', 'Agent reported an error.');
      }
    });

    events.on(agentSessionExitedChannel, (e) => {
      const runId = this.active.get(e.taskId);
      if (!runId) return;
      this.active.delete(e.taskId);
      const ok = e.exitCode === 0 || e.exitCode === undefined;
      void automationService.finishRun(
        runId,
        ok ? 'success' : 'failed',
        ok ? null : `Agent exited with code ${e.exitCode}`
      );
    });
  }

  async fire(automationId: string, trigger: 'manual' | 'cron'): Promise<void> {
    const auto = await automationService.get(automationId);
    if (!auto) {
      log.warn('[automation] fire: automation not found', { automationId });
      return;
    }
    // Scheduled runs respect pause; manual runs always go.
    if (trigger === 'cron' && auto.status !== 'active') return;

    // Overlap guard: skip if a previous run is still in flight.
    if (await automationService.hasRunningRun(automationId)) {
      const runId = await automationService.startRun(automationId, trigger);
      await automationService.finishRun(runId, 'skipped', 'Previous run still in progress.');
      return;
    }

    const runId = await automationService.startRun(automationId, trigger);
    try {
      const existing = await db
        .select({ name: tasks.name })
        .from(tasks)
        .where(eq(tasks.projectId, INTERNAL_PROJECT_ID));
      const taskName = ensureUniqueTaskSlug(
        auto.title,
        existing.map((r) => r.name)
      );
      const taskId = randomUUID();
      const conversationId = randomUUID();
      const title = taskNameFromPrompt(auto.prompt) || auto.title;

      const result = await createTask({
        id: taskId,
        projectId: INTERNAL_PROJECT_ID,
        name: taskName,
        sourceBranch: { type: 'local', branch: 'main' },
        strategy: { kind: 'no-worktree' },
        initialConversation: {
          id: conversationId,
          projectId: INTERNAL_PROJECT_ID,
          taskId,
          runtime: auto.runtime,
          title,
          initialPrompt: auto.prompt,
          autoApprove: true, // unattended
        },
      });

      if (!result.success) {
        await automationService.finishRun(runId, 'failed', JSON.stringify(result.error));
        return;
      }

      this.active.set(taskId, runId);
      await automationService.setRunTask(runId, taskId);
      await automationService.setLastRunAt(automationId, new Date().toISOString());
    } catch (error) {
      await automationService.finishRun(
        runId,
        'failed',
        error instanceof Error ? error.message : String(error)
      );
    }
  }
}

export const automationRunner = new AutomationRunner();
