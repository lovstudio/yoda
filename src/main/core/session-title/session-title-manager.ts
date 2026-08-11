import { and, eq, isNull, sql } from 'drizzle-orm';
import { conversationRenamedChannel } from '@shared/events/conversationEvents';
import type { RuntimeId } from '@shared/runtime-registry';
import { normalizeTaskDisplayName as normalizeSessionTitle } from '@shared/task-name';
import { conversationEvents } from '@main/core/conversations/conversation-events';
import { createLocalAgentSessionCatalogId } from '@main/core/conversations/local-agent-session-catalog';
import { storeConversationSessionSource } from '@main/core/conversations/stored-conversation-session-source';
import { db } from '@main/db/client';
import { conversations } from '@main/db/schema';
import { events } from '@main/lib/events';
import { log } from '@main/lib/logger';
import { ClaudeSessionTitleSource } from './claude-title-source';
import { CodexSessionTitleSource } from './codex-title-source';
import type { SessionTitleContext, SessionTitleSource, SessionTitleWatcher } from './types';

class SessionTitleManager {
  private readonly sources = new Map<RuntimeId, SessionTitleSource>();
  private readonly watchers = new Map<string, SessionTitleWatcher>();

  constructor() {
    this.register(new ClaudeSessionTitleSource());
    this.register(new CodexSessionTitleSource());
  }

  register(source: SessionTitleSource): void {
    this.sources.set(source.runtimeId, source);
  }

  start(ctx: SessionTitleContext): void {
    const source = this.sources.get(ctx.runtimeId);
    if (!source) return;
    const key = ctx.conversationId;
    this.stop(key);
    const watcher = source.watch(
      ctx,
      (title) => {
        void this.applyTitle(ctx, title).catch((err) => {
          log.warn('SessionTitleManager: applyTitle failed', {
            conversationId: ctx.conversationId,
            runtimeId: ctx.runtimeId,
            error: String(err),
          });
        });
      },
      (sessionId) => this.applySessionBinding(ctx, sessionId)
    );
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
    const displayTitle = normalizeSessionTitle(rawTitle);
    if (!displayTitle) return;

    const [convRow] = await db
      .select({ title: conversations.title, titleSource: conversations.titleSource })
      .from(conversations)
      .where(
        and(
          eq(conversations.id, ctx.conversationId),
          eq(conversations.projectId, ctx.projectId),
          eq(conversations.taskId, ctx.taskId),
          isNull(conversations.archivedAt)
        )
      )
      .limit(1);
    if (!convRow) return;

    // The provider CLI's auto-title is only an interim name: once our own
    // naming ('yoda') or the user has set a title, never overwrite it. This
    // also guards against replayed title rows when resuming old transcripts.
    if (convRow.titleSource === 'user' || convRow.titleSource === 'yoda') return;

    if (convRow.title !== displayTitle) {
      const [updated] = await db
        .update(conversations)
        .set({
          title: displayTitle,
          titleSource: 'agent',
          updatedAt: sql`CURRENT_TIMESTAMP`,
        })
        .where(
          and(
            eq(conversations.id, ctx.conversationId),
            eq(conversations.projectId, ctx.projectId),
            eq(conversations.taskId, ctx.taskId),
            isNull(conversations.archivedAt),
            sql`${conversations.title} IS ${convRow.title}`,
            sql`${conversations.titleSource} IS ${convRow.titleSource}`
          )
        )
        .returning({ id: conversations.id });
      if (!updated) return;
      conversationEvents._emit(
        'conversation:renamed',
        ctx.conversationId,
        ctx.projectId,
        ctx.taskId,
        displayTitle
      );
      events.emit(conversationRenamedChannel, {
        conversationId: ctx.conversationId,
        projectId: ctx.projectId,
        taskId: ctx.taskId,
        title: displayTitle,
      });
    }
  }

  private async applySessionBinding(ctx: SessionTitleContext, sessionId: string): Promise<boolean> {
    if (ctx.runtimeId !== 'codex' || !ctx.stateRoot) return false;
    return storeConversationSessionSource(
      ctx.conversationId,
      {
        catalogId: createLocalAgentSessionCatalogId('codex', ctx.stateRoot, sessionId),
        runtimeId: 'codex',
        sessionId,
        stateRoot: ctx.stateRoot,
      },
      {
        projectId: ctx.projectId,
        taskId: ctx.taskId,
        expectedPendingAttemptStartedAtMs: ctx.initialPromptAttemptStartedAtMs,
      }
    );
  }
}

export const sessionTitleManager = new SessionTitleManager();
