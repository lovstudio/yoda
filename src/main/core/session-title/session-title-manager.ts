import { eq, sql } from 'drizzle-orm';
import type { AgentProviderId } from '@shared/agent-provider-registry';
import { taskRenamedChannel } from '@shared/events/taskEvents';
import { normalizeTaskDisplayName } from '@shared/task-name';
import { taskEvents } from '@main/core/tasks/task-events';
import { mapTaskRowToTask } from '@main/core/tasks/utils/utils';
import { db } from '@main/db/client';
import { conversations, tasks } from '@main/db/schema';
import { events } from '@main/lib/events';
import { log } from '@main/lib/logger';
import { ClaudeSessionTitleSource } from './claude-title-source';
import { CodexSessionTitleSource } from './codex-title-source';
import type { SessionTitleContext, SessionTitleSource, SessionTitleWatcher } from './types';

class SessionTitleManager {
  private readonly sources = new Map<AgentProviderId, SessionTitleSource>();
  private readonly watchers = new Map<string, SessionTitleWatcher>();

  constructor() {
    this.register(new ClaudeSessionTitleSource());
    this.register(new CodexSessionTitleSource());
  }

  register(source: SessionTitleSource): void {
    this.sources.set(source.providerId, source);
  }

  start(ctx: SessionTitleContext): void {
    const source = this.sources.get(ctx.providerId);
    if (!source) return;
    const key = ctx.conversationId;
    this.stop(key);
    const watcher = source.watch(ctx, (title) => {
      void this.applyTitle(ctx, title).catch((err) => {
        log.warn('SessionTitleManager: applyTitle failed', {
          conversationId: ctx.conversationId,
          providerId: ctx.providerId,
          error: String(err),
        });
      });
    });
    this.watchers.set(key, watcher);
  }

  stop(conversationId: string): void {
    const watcher = this.watchers.get(conversationId);
    if (!watcher) return;
    try {
      watcher.stop();
    } catch (err) {
      log.warn('SessionTitleManager: watcher.stop threw', {
        conversationId,
        error: String(err),
      });
    }
    this.watchers.delete(conversationId);
  }

  private async applyTitle(ctx: SessionTitleContext, rawTitle: string): Promise<void> {
    const displayName = normalizeTaskDisplayName(rawTitle);
    if (!displayName) return;

    // Only mirror onto the task name if this conversation is the task's primary
    // (= initial) one. Avoids later side conversations renaming the task.
    const [convRow] = await db
      .select({ isInitial: conversations.isInitialConversation })
      .from(conversations)
      .where(eq(conversations.id, ctx.conversationId))
      .limit(1);
    if (!convRow || convRow.isInitial !== true) return;

    const [row] = await db.select().from(tasks).where(eq(tasks.id, ctx.taskId)).limit(1);
    if (!row || row.isUserNamed === 1) return;
    if (row.name === displayName) return;

    const [updatedRow] = await db
      .update(tasks)
      .set({
        name: displayName,
        updatedAt: sql`CURRENT_TIMESTAMP`,
      })
      .where(eq(tasks.id, ctx.taskId))
      .returning();

    if (!updatedRow) return;
    taskEvents._emit('task:updated', mapTaskRowToTask(updatedRow));
    events.emit(taskRenamedChannel, {
      taskId: ctx.taskId,
      projectId: ctx.projectId,
      name: displayName,
      isUserNamed: false,
    });
  }
}

export const sessionTitleManager = new SessionTitleManager();
