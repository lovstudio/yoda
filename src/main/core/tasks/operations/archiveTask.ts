import { and, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import { taskArchivedChannel } from '@shared/events/taskEvents';
import type { ArchiveTaskResult } from '@shared/tasks';
import { archiveConversation } from '@main/core/conversations/archiveConversation';
import { runPreArchiveCommand } from '@main/core/conversations/pre-archive-command';
import { mapConversationRowToConversation } from '@main/core/conversations/utils';
import { projectManager } from '@main/core/projects/project-manager';
import { appSettingsService } from '@main/core/settings/settings-service';
import { snapshotTaskDiffTotals } from '@main/core/stats/task-diff-snapshot';
import { taskEvents } from '@main/core/tasks/task-events';
import { taskManager } from '@main/core/tasks/task-manager';
import { db } from '@main/db/client';
import { conversations, projects, tasks } from '@main/db/schema';
import { events } from '@main/lib/events';
import { log } from '@main/lib/logger';
import { telemetryService } from '@main/lib/telemetry';
import { getDescendantTaskIds } from './task-hierarchy';

export type ArchiveTaskOptions = {
  /** Skip injecting the configured pre-archive command into live sessions. */
  skipPreCommand?: boolean;
  /**
   * One-off pre-archive command to run instead of the configured setting
   * (the user edited it in the archive dialog). Ignored when `skipPreCommand`.
   */
  preArchiveCommand?: string;
};

/**
 * Fully main-process archive orchestration: persist the archive intent, run
 * the pre-archive command against every live conversation, archive the
 * conversations, then archive the task rows. The renderer only awaits the
 * RPC — a renderer reload (dev hot-reload, window close) no longer loses an
 * in-flight archive; interrupted archives are resumed at startup via
 * `resumePendingTaskArchives`.
 */
export async function archiveTask(
  projectId: string,
  taskId: string,
  note?: string,
  options: ArchiveTaskOptions = {}
): Promise<ArchiveTaskResult> {
  // Cascade: archive all non-archived descendants bottom-up (children before
  // parents) so worktree/teardown work happens sequentially per task and the
  // tree never has an archived parent with live children mid-flight.
  const descendantIds = await getDescendantTaskIds(taskId);
  const activeDescendantIds: string[] = [];

  if (descendantIds.length > 0) {
    const activeDescendants = await db
      .select({ id: tasks.id })
      .from(tasks)
      .where(and(inArray(tasks.id, descendantIds), isNull(tasks.archivedAt)));
    const activeIds = new Set(activeDescendants.map((d) => d.id));
    // descendantIds is parents-before-children; reverse for bottom-up order.
    for (const descendantId of [...descendantIds].reverse()) {
      if (activeIds.has(descendantId)) activeDescendantIds.push(descendantId);
    }
  }

  // Persist the archive intent (and note) up front so an interrupted archive
  // is visible in the DB and resumable after a restart.
  const trimmedNote = note?.trim();
  await db
    .update(tasks)
    .set({ archiveRequestedAt: sql`CURRENT_TIMESTAMP` })
    .where(inArray(tasks.id, [...activeDescendantIds, taskId]));
  await db
    .update(tasks)
    .set({ archiveNote: trimmedNote && trimmedNote.length > 0 ? trimmedNote : null })
    .where(eq(tasks.id, taskId));

  const preArchiveCommand = options.skipPreCommand
    ? ''
    : (options.preArchiveCommand ?? (await appSettingsService.get('homeDraft')).preArchiveCommand);

  const archivedTaskIds: string[] = [];
  for (const descendantId of activeDescendantIds) {
    await archiveSingleTask(projectId, descendantId, preArchiveCommand);
    archivedTaskIds.push(descendantId);
  }
  await archiveSingleTask(projectId, taskId, preArchiveCommand);
  archivedTaskIds.push(taskId);
  return { archivedTaskIds };
}

/**
 * Finish archives that were requested but never completed (renderer reload,
 * app crash/quit mid-archive). Skips the pre-archive command — the sessions
 * that were supposed to run it are from a previous app lifetime.
 */
export async function resumePendingTaskArchives(): Promise<void> {
  const pending = await db
    .select({ id: tasks.id, projectId: tasks.projectId })
    .from(tasks)
    .where(and(isNotNull(tasks.archiveRequestedAt), isNull(tasks.archivedAt)));
  if (pending.length === 0) return;

  log.info('archiveTask: resuming interrupted archives', { count: pending.length });
  for (const task of pending) {
    await archiveSingleTask(task.projectId, task.id, '').catch((e: unknown) => {
      log.warn('archiveTask: resume failed', { taskId: task.id, error: String(e) });
    });
  }
}

async function archiveSingleTask(
  projectId: string,
  taskId: string,
  preArchiveCommand: string
): Promise<void> {
  const [row] = await db
    .select({
      task: tasks,
      projectPath: projects.path,
    })
    .from(tasks)
    .innerJoin(projects, eq(tasks.projectId, projects.id))
    .where(and(eq(tasks.id, taskId), eq(tasks.projectId, projectId)))
    .limit(1);
  if (!row) return;

  const task = row.task;
  const project = projectManager.getProject(projectId);

  await archiveTaskConversations(projectId, taskId, preArchiveCommand);

  // Snapshot diff totals while the worktree still exists — teardown below
  // removes it and the live diff with it.
  await snapshotTaskDiffTotals(taskId).catch((e: unknown) => {
    log.warn('archiveTask: diff snapshot failed', { taskId, error: String(e) });
  });

  await db
    .update(tasks)
    .set({
      status: 'archived',
      archivedAt: sql`CURRENT_TIMESTAMP`,
      updatedAt: sql`CURRENT_TIMESTAMP`,
      statusChangedAt: sql`CURRENT_TIMESTAMP`,
    })
    .where(eq(tasks.id, taskId));
  taskEvents._emit('task:archived', taskId, projectId);
  events.emit(taskArchivedChannel, { taskId, projectId });
  telemetryService.capture('task_archived', {
    project_id: projectId,
    task_id: taskId,
    has_note: Boolean(task.archiveNote),
  });

  if (!project) return;

  void taskManager
    .teardownTask(taskId, 'terminate')
    .then((teardownResult) => {
      if (!teardownResult.success) {
        log.warn('archiveTask: teardown failed', { taskId, error: teardownResult.error.message });
      }
    })
    .catch((e: unknown) => {
      log.warn('archiveTask: teardown failed', { taskId, error: String(e) });
    });

  if (task.taskBranch) {
    const siblings = await db
      .select({ id: tasks.id })
      .from(tasks)
      .where(
        and(
          eq(tasks.projectId, task.projectId),
          eq(tasks.taskBranch, task.taskBranch),
          isNull(tasks.archivedAt)
        )
      )
      .limit(1);

    if (siblings.length === 0) {
      await project.removeTaskWorktree(task.taskBranch).catch((e) => {
        log.warn('archiveTask: worktree removal failed', { taskId, error: String(e) });
      });
    }
  }
}

/**
 * Run the pre-archive command against every live conversation of the task
 * (in parallel), then archive each conversation. `archiveConversation` owns
 * the per-conversation side effects (Codex thread archive, session stop,
 * renderer events).
 */
async function archiveTaskConversations(
  projectId: string,
  taskId: string,
  preArchiveCommand: string
): Promise<void> {
  const rows = await db
    .select()
    .from(conversations)
    .where(
      and(
        eq(conversations.projectId, projectId),
        eq(conversations.taskId, taskId),
        isNull(conversations.archivedAt)
      )
    );
  if (rows.length === 0) return;

  await Promise.all(
    rows.map(async (convRow) => {
      const conversation = mapConversationRowToConversation(convRow, true);
      if (preArchiveCommand) {
        await runPreArchiveCommand(
          {
            projectId,
            taskId,
            conversationId: conversation.id,
            runtimeId: conversation.runtimeId,
          },
          preArchiveCommand
        );
      }
      await archiveConversation(projectId, taskId, conversation.id).catch((error: unknown) => {
        log.warn('archiveTask: conversation archive failed', {
          taskId,
          conversationId: conversation.id,
          error: String(error),
        });
      });
    })
  );
}
