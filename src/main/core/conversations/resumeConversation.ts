import { and, eq } from 'drizzle-orm';
import type {
  Conversation,
  ConversationResumeResult,
  ConversationSurfaceAnchor,
} from '@shared/conversations';
import { makePtySessionId } from '@shared/ptySessionId';
import type { SessionOpenPerformanceContext } from '@shared/session-open-performance';
import { ptySessionRegistry } from '@main/core/pty/pty-session-registry';
import { TmuxReattachMissError } from '@main/core/pty/tmux-reattach';
import { db } from '@main/db/client';
import { conversations } from '@main/db/schema';
import { log } from '@main/lib/logger';
import { resolveTask } from '../projects/utils';
import { loadCodexRolloutSurfaceAnchorForConversation } from './codex-rollout-terminal-history';
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
import { createSessionOpenPerformanceTrace } from './session-open-performance';
import type { GenerationBoundConversationResumeResult } from './types';
import { mapConversationRowToConversation } from './utils';

const inFlightResumes = new Map<string, Promise<GenerationBoundConversationResumeResult>>();

function resolveConversationSurfaceAnchor(
  conversation: Conversation,
  cwd: string,
  isResuming: boolean
): Promise<ConversationSurfaceAnchor> {
  if (!isResuming) return Promise.resolve({ kind: 'none' });
  if (conversation.runtimeId !== 'codex') return Promise.resolve({ kind: 'unverifiable' });
  return loadCodexRolloutSurfaceAnchorForConversation({ conversation, cwd }).catch(() => ({
    kind: 'unverifiable',
  }));
}

export async function resumeConversationWithResult(
  projectId: string,
  taskId: string,
  conversationId: string,
  initialSize?: { cols: number; rows: number },
  performanceContext?: SessionOpenPerformanceContext
): Promise<GenerationBoundConversationResumeResult> {
  const sessionKey = makePtySessionId(projectId, taskId, conversationId);
  const trace = createSessionOpenPerformanceTrace(performanceContext, {
    projectId,
    taskId,
    conversationId,
    sessionId: sessionKey,
  });
  const resumeStartedAt = trace?.startSpan();
  trace?.mark('resume-received', {
    cols: initialSize?.cols,
    rows: initialSize?.rows,
  });
  const existing = inFlightResumes.get(sessionKey);
  if (existing) {
    trace?.mark('inflight-joined');
    return existing.then(
      (result) => {
        if (resumeStartedAt !== undefined) {
          trace?.endSpan('resume-resolved', resumeStartedAt, {
            success: true,
            running: result.running,
            reason: result.reason,
            generation: result.generation,
            resumePath: 'inflight-join',
          });
        }
        return result;
      },
      (error) => {
        if (resumeStartedAt !== undefined) {
          trace?.endSpan('resume-resolved', resumeStartedAt, {
            success: false,
            running: false,
            errorKind: error instanceof Error ? error.name : typeof error,
            resumePath: 'inflight-join',
          });
        }
        throw error;
      }
    );
  }

  // Publish the explicit resume intent before crossing the startup hydration
  // barrier. A visible renderer can subscribe while the tmux-marker decision
  // is still pending; without this intent the PTY controller mistakes that
  // window for an offline session and replays the rollout transcript into the
  // live terminal. The later backend generation then has to reset that text,
  // producing the raw-history -> blank -> TUI transition on every cold open.
  const registrationEpoch = ptySessionRegistry.beginRegistration(
    makePtySessionId(projectId, taskId, conversationId)
  );
  const operation: Promise<GenerationBoundConversationResumeResult> = (async () => {
    try {
      const hydration = getConversationHydrationBarrier(projectId, taskId, conversationId);
      if (hydration) {
        try {
          if (trace) {
            await trace.measure('hydration-barrier', () => hydration, { present: true });
          } else {
            await hydration;
          }
        } catch (error) {
          log.warn('resumeConversation: startup hydration failed before explicit resume', {
            projectId,
            taskId,
            conversationId,
            error: String(error),
          });
        }
        if (wasConversationHydrationCancelled(hydration)) {
          return {
            running: false,
            generation: ptySessionRegistry.getGeneration(sessionKey),
          };
        }
      } else {
        trace?.mark('hydration-barrier', { present: false, skipped: true, durationMs: 0 });
      }
      const operationQueuedAt = trace?.startSpan();
      const result: ConversationResumeResult = await withConversationOperation(
        { projectId, id: conversationId },
        async () => {
          if (operationQueuedAt !== undefined) {
            trace?.endSpan('operation-lock', operationQueuedAt, { acquired: true });
          }
          const rows = trace
            ? await trace.measure(
                'conversation-query',
                () =>
                  db
                    .select()
                    .from(conversations)
                    .where(
                      and(
                        eq(conversations.id, conversationId),
                        eq(conversations.projectId, projectId),
                        eq(conversations.taskId, taskId)
                      )
                    )
                    .limit(1),
                (result) => ({ found: Boolean(result[0]) })
              )
            : await db
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
          const [row] = rows;

          if (!row || row.archivedAt) return { running: false };

          const task = trace
            ? trace.measureSync(
                'task-resolve',
                () => resolveTask(projectId, taskId),
                (result) => ({ found: Boolean(result) })
              )
            : resolveTask(projectId, taskId);
          if (!task) {
            throw new Error(`Task not provisioned: ${taskId}`);
          }

          if (!ptySessionRegistry.ownsRegistration(sessionKey, registrationEpoch)) {
            return { running: false };
          }
          const mappedConversation = mapConversationRowToConversation(row, true);
          const conversation = trace
            ? await trace.measure(
                'permission-reconcile',
                () => reconcileConversationPermission(mappedConversation, row.config),
                (result) => ({ runtimeId: result.runtimeId })
              )
            : await reconcileConversationPermission(mappedConversation, row.config);
          const pending = conversation.pendingInitialPrompt;
          const start = hydratedConversationStart(conversation);
          // Begin the bounded transcript read before provider startup, then let
          // it overlap writer probing, tmux attach and process spawn. The anchor
          // therefore adds no serial wait to the provider-start critical path.
          const resolveSurfaceAnchor = () =>
            resolveConversationSurfaceAnchor(
              conversation,
              task.conversations.taskPath,
              start.isResuming
            );
          const surfaceAnchorPromise = trace
            ? trace.measure('surface-anchor', resolveSurfaceAnchor, (surfaceAnchor) => ({
                kind: surfaceAnchor.kind,
                segmentCount: surfaceAnchor.kind === 'anchor' ? surfaceAnchor.segments.length : 0,
              }))
            : resolveSurfaceAnchor();
          const activeSession = task.conversations
            .getActiveSessions()
            .find((session) => session.conversationId === conversationId);
          const detachedTmuxSession = Boolean(
            activeSession?.detachable && activeSession.transportAttached === false
          );
          trace?.mark('session-classified', {
            active: Boolean(activeSession),
            detached: detachedTmuxSession,
            runtimeId: conversation.runtimeId,
            resumePath: activeSession
              ? detachedTmuxSession
                ? 'detached-reattach'
                : 'active'
              : 'provider-resume',
          });
          if (activeSession && !detachedTmuxSession) {
            trace?.mark('external-writer-probe', {
              skipped: true,
              reason: 'active-session',
              durationMs: 0,
            });
            return { running: true, surfaceAnchor: await surfaceAnchorPromise };
          }
          let externalWriter = false;
          if (detachedTmuxSession) {
            trace?.mark('external-writer-probe', {
              skipped: true,
              reason: 'detached-session',
              durationMs: 0,
            });
          } else {
            externalWriter = trace
              ? await trace.measure(
                  'external-writer-probe',
                  () => hasExternalCodexThreadWriter(conversation.sessionSource),
                  (active) => ({
                    applicable: conversation.sessionSource?.runtimeId === 'codex',
                    writerActive: active,
                  })
                )
              : await hasExternalCodexThreadWriter(conversation.sessionSource);
          }
          if (externalWriter) {
            log.info('resumeConversation: imported Codex thread is active in another process', {
              projectId,
              taskId,
              conversationId,
              threadId: conversation.sessionSource?.sessionId,
            });
            return { running: false, reason: 'external-writer' };
          }
          if (!ptySessionRegistry.ownsRegistration(sessionKey, registrationEpoch)) {
            return { running: false };
          }
          const startSession = (
            reattachExistingTmuxSession: boolean,
            attempt: 'reattach' | 'resume'
          ): Promise<void> => {
            const args = [
              conversation,
              initialSize,
              start.isResuming,
              start.initialPrompt,
              undefined,
              start.imagePaths,
              { model: start.model, reasoningEffort: start.reasoningEffort },
            ] as const;
            const startOptions = reattachExistingTmuxSession
              ? {
                  reattachExistingTmuxSession: true,
                  ...(trace ? { performanceTrace: trace } : {}),
                }
              : trace
                ? { performanceTrace: trace }
                : undefined;
            const startProvider = () =>
              startOptions
                ? task.conversations.startSession(...args, startOptions)
                : task.conversations.startSession(...args);
            return trace
              ? trace.measure('provider-start', startProvider, {
                  attempt,
                  reattachExisting: reattachExistingTmuxSession,
                  runtimeId: conversation.runtimeId,
                })
              : startProvider();
          };
          try {
            await startSession(detachedTmuxSession, detachedTmuxSession ? 'reattach' : 'resume');
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
            await startSession(false, 'resume');
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
          const running = task.conversations
            .getActiveSessions()
            .some(
              (session) =>
                session.conversationId === conversationId && session.transportAttached !== false
            );
          return running
            ? { running: true, surfaceAnchor: await surfaceAnchorPromise }
            : { running: false };
        }
      );
      // Capture the generation before the registration intent is released in
      // finally. The controller must forward this exact evidence pair instead
      // of sampling a potentially newer backend generation afterwards.
      return {
        ...result,
        generation: ptySessionRegistry.getGeneration(sessionKey),
      };
    } finally {
      ptySessionRegistry.cancelRegistration(sessionKey, registrationEpoch);
    }
  })();

  const resolvedOperation = operation.then(
    (result) => {
      if (resumeStartedAt !== undefined) {
        trace?.endSpan('resume-resolved', resumeStartedAt, {
          success: true,
          running: result.running,
          reason: result.reason,
          generation: result.generation,
        });
      }
      return result;
    },
    (error) => {
      if (resumeStartedAt !== undefined) {
        trace?.endSpan('resume-resolved', resumeStartedAt, {
          success: false,
          running: false,
          generation: ptySessionRegistry.getGeneration(sessionKey),
          errorKind: error instanceof Error ? error.name : typeof error,
        });
      }
      throw error;
    }
  );

  const tracked = resolvedOperation.finally(() => {
    if (inFlightResumes.get(sessionKey) === tracked) inFlightResumes.delete(sessionKey);
  });
  inFlightResumes.set(sessionKey, tracked);
  return tracked;
}

export async function resumeConversation(
  projectId: string,
  taskId: string,
  conversationId: string,
  initialSize?: { cols: number; rows: number },
  performanceContext?: SessionOpenPerformanceContext
): Promise<boolean> {
  const result = await resumeConversationWithResult(
    projectId,
    taskId,
    conversationId,
    initialSize,
    performanceContext
  );
  return result.running;
}
