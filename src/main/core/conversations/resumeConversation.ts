import { and, eq } from 'drizzle-orm';
import { makePtySessionId } from '@shared/ptySessionId';
import { ptySessionRegistry } from '@main/core/pty/pty-session-registry';
import { TmuxReattachMissError } from '@main/core/pty/tmux-reattach';
import { db } from '@main/db/client';
import { conversations } from '@main/db/schema';
import { log } from '@main/lib/logger';
import { resolveTask } from '../projects/utils';
import { hasExternalCodexThreadWriter } from './codex-thread-writer';
import {
  getConversationHydrationBarrier,
  wasConversationHydrationCancelled,
} from './conversation-hydration-barrier';
import { withConversationOperation } from './conversation-operation-lock';
import {
  hydratedConversationStart,
  shouldClearPendingInitialPromptAfterStart,
} from './pending-initial-prompt';
import { clearPendingInitialPrompt } from './pending-initial-prompt-store';
import { reconcileConversationPermission } from './reconcile-conversation-permission';
import { mapConversationRowToConversation } from './utils';

const inFlightResumes = new Map<string, Promise<boolean>>();

export async function resumeConversation(
  projectId: string,
  taskId: string,
  conversationId: string,
  initialSize?: { cols: number; rows: number }
): Promise<boolean> {
  const sessionKey = `${projectId}:${taskId}:${conversationId}`;
  const existing = inFlightResumes.get(sessionKey);
  if (existing) return existing;

  // Publish the explicit resume intent before crossing the startup hydration
  // barrier. A visible renderer can subscribe while the tmux-marker decision
  // is still pending; without this intent the PTY controller mistakes that
  // window for an offline session and replays the rollout transcript into the
  // live terminal. The later backend generation then has to reset that text,
  // producing the raw-history -> blank -> TUI transition on every cold open.
  const registrationEpoch = ptySessionRegistry.beginRegistration(
    makePtySessionId(projectId, taskId, conversationId)
  );
  const operation = (async () => {
    try {
      const hydration = getConversationHydrationBarrier(projectId, taskId, conversationId);
      if (hydration) {
        try {
          await hydration;
        } catch (error) {
          log.warn('resumeConversation: startup hydration failed before explicit resume', {
            projectId,
            taskId,
            conversationId,
            error: String(error),
          });
        }
        if (wasConversationHydrationCancelled(hydration)) return false;
      }
      return await withConversationOperation({ projectId, id: conversationId }, async () => {
        const [row] = await db
          .select()
          .from(conversations)
          .where(
            and(
              eq(conversations.id, conversationId),
              eq(conversations.projectId, projectId),
              eq(conversations.taskId, taskId)
            )
          )
          .limit(1);

        if (!row || row.archivedAt) return false;

        const task = resolveTask(projectId, taskId);
        if (!task) {
          throw new Error(`Task not provisioned: ${taskId}`);
        }

        if (!ptySessionRegistry.ownsRegistration(sessionKey, registrationEpoch)) return false;
        const conversation = await reconcileConversationPermission(
          mapConversationRowToConversation(row, true),
          row.config
        );
        const activeSession = task.conversations
          .getActiveSessions()
          .find((session) => session.conversationId === conversationId);
        const detachedTmuxSession = Boolean(
          activeSession?.detachable && activeSession.transportAttached === false
        );
        if (activeSession && !detachedTmuxSession) {
          return true;
        }
        if (
          !detachedTmuxSession &&
          (await hasExternalCodexThreadWriter(conversation.sessionSource))
        ) {
          log.info('resumeConversation: imported Codex thread is active in another process', {
            projectId,
            taskId,
            conversationId,
            threadId: conversation.sessionSource?.sessionId,
          });
          return false;
        }
        if (!ptySessionRegistry.ownsRegistration(sessionKey, registrationEpoch)) return false;
        const pending = conversation.pendingInitialPrompt;
        const start = hydratedConversationStart(conversation);
        const startSession = (reattachExistingTmuxSession: boolean): Promise<void> => {
          const args = [
            conversation,
            initialSize,
            start.isResuming,
            start.initialPrompt,
            undefined,
            start.imagePaths,
            { model: start.model, reasoningEffort: start.reasoningEffort },
          ] as const;
          return reattachExistingTmuxSession
            ? task.conversations.startSession(...args, { reattachExistingTmuxSession: true })
            : task.conversations.startSession(...args);
        };
        try {
          await startSession(detachedTmuxSession);
        } catch (error) {
          if (!(detachedTmuxSession && error instanceof TmuxReattachMissError)) throw error;
          // The detached tmux pane can finish during its headless interval. A
          // strict attach miss is therefore safe to downgrade to the ordinary
          // provider resume path, which recreates the pane from durable history.
          log.info('resumeConversation: detached tmux pane ended; resuming normally', {
            projectId,
            taskId,
            conversationId,
          });
          await startSession(false);
        }
        if (
          pending &&
          shouldClearPendingInitialPromptAfterStart(task.conversations, conversation.runtimeId)
        ) {
          await clearPendingInitialPrompt(conversation.id, {
            projectId: conversation.projectId,
            taskId: conversation.taskId,
            deliveryToken: pending.deliveryToken,
          });
        }
        return task.conversations
          .getActiveSessions()
          .some(
            (session) =>
              session.conversationId === conversationId && session.transportAttached !== false
          );
      });
    } finally {
      ptySessionRegistry.cancelRegistration(sessionKey, registrationEpoch);
    }
  })();

  const tracked = operation.finally(() => {
    if (inFlightResumes.get(sessionKey) === tracked) inFlightResumes.delete(sessionKey);
  });
  inFlightResumes.set(sessionKey, tracked);
  return tracked;
}
