import { and, eq, isNull } from 'drizzle-orm';
import { Notification } from 'electron';
import type { KanbanColumnHook } from '@shared/app-settings';
import { notificationCreatedChannel } from '@shared/events/appEvents';
import type { KanbanStatus } from '@shared/kanban';
import { injectAgentCommand } from '@main/core/conversations/pre-archive-command';
import { mapConversationRowToConversation } from '@main/core/conversations/utils';
import { projectManager } from '@main/core/projects/project-manager';
import { appSettingsService } from '@main/core/settings/settings-service';
import { db } from '@main/db/client';
import { conversations, tasks } from '@main/db/schema';
import { events } from '@main/lib/events';
import { log } from '@main/lib/logger';
import { quoteShellArg } from '@main/utils/shellEscape';

const COMMAND_TIMEOUT_MS = 5 * 60_000;

type HookContext = {
  projectId: string;
  taskId: string;
  taskName: string;
  taskBranch: string | null;
};

/**
 * Run the user-configured hooks for a kanban column after a card lands in it.
 * Lives in the main process so hooks survive renderer reloads. Each hook is
 * isolated: a failing hook is logged and never blocks the others (or the
 * status transition itself, which is already persisted by the caller).
 */
export async function runKanbanColumnHooks(
  projectId: string,
  taskId: string,
  status: KanbanStatus
): Promise<number> {
  const { hooksByStatus } = await appSettingsService.get('kanban');
  const hooks = (hooksByStatus[status] ?? []).filter((hook) => hook.enabled);
  if (hooks.length === 0) return 0;

  const [task] = await db
    .select({ name: tasks.name, taskBranch: tasks.taskBranch })
    .from(tasks)
    .where(eq(tasks.id, taskId))
    .limit(1);
  if (!task) return 0;

  const ctx: HookContext = { projectId, taskId, taskName: task.name, taskBranch: task.taskBranch };
  for (const hook of hooks) {
    try {
      await runHook(hook, ctx);
    } catch (error) {
      log.warn('kanban hook failed', {
        taskId,
        status,
        hookType: hook.action.type,
        error: String(error),
      });
    }
  }
  return hooks.length;
}

async function runHook(hook: KanbanColumnHook, ctx: HookContext): Promise<void> {
  switch (hook.action.type) {
    case 'prompt':
      return runPromptHook(ctx, hook.action.text);
    case 'command':
      return runCommandHook(ctx, hook.action.command);
    case 'notify':
      return runNotifyHook(ctx, hook.action.message);
  }
}

/** Inject the prompt into every live (non-archived) session of the task. */
async function runPromptHook(ctx: HookContext, text: string): Promise<void> {
  const rows = await db
    .select()
    .from(conversations)
    .where(
      and(
        eq(conversations.projectId, ctx.projectId),
        eq(conversations.taskId, ctx.taskId),
        isNull(conversations.archivedAt)
      )
    );

  let injected = 0;
  for (const row of rows) {
    const conversation = mapConversationRowToConversation(row, true);
    const ok = await injectAgentCommand(
      {
        projectId: ctx.projectId,
        taskId: ctx.taskId,
        conversationId: conversation.id,
        runtimeId: conversation.runtimeId,
      },
      text,
      'kanban-hook'
    );
    if (ok) injected++;
  }
  if (injected === 0) {
    log.info('kanban prompt hook: no live sessions to inject into', { taskId: ctx.taskId });
  }
}

/** Run the shell command in the task worktree (project root when no worktree). */
async function runCommandHook(ctx: HookContext, command: string): Promise<void> {
  const trimmed = command.trim();
  if (!trimmed) return;

  const project = projectManager.getProject(ctx.projectId);
  if (!project) throw new Error(`Project not found: ${ctx.projectId}`);

  const worktreePath = ctx.taskBranch
    ? await project.getWorktreeForBranch(ctx.taskBranch)
    : undefined;
  // ctx.exec runs at the project root on both local and SSH hosts; cd into the
  // worktree inside the shell so the hook sees the task's working copy.
  const script = worktreePath ? `cd ${quoteShellArg(worktreePath)} && (${trimmed})` : trimmed;

  const result = await project.ctx.exec('sh', ['-c', script], { timeout: COMMAND_TIMEOUT_MS });
  log.info('kanban command hook finished', {
    taskId: ctx.taskId,
    cwd: worktreePath ?? 'project root',
    stdout: result.stdout?.slice(0, 500),
  });
}

function runNotifyHook(ctx: HookContext, message: string): void {
  events.emit(notificationCreatedChannel, {
    title: ctx.taskName,
    description: message,
    details: [`Project: ${ctx.projectId}`, `Task: ${ctx.taskId}`].join('\n'),
    kind: 'info',
    source: 'automation',
    reason: 'subscribed-result',
    target: { projectId: ctx.projectId, taskId: ctx.taskId },
  });
  if (!Notification.isSupported()) return;
  new Notification({ title: ctx.taskName, body: message, silent: true }).show();
}
