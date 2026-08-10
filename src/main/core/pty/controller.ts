import { randomUUID } from 'node:crypto';
import { basename } from 'node:path';
import { and, eq } from 'drizzle-orm';
import { createRPCController } from '@shared/ipc/rpc';
import { parsePtySessionId } from '@shared/ptySessionId';
import { err, ok } from '@shared/result';
import { loadCodexRolloutTerminalHistoryForConversation } from '@main/core/conversations/codex-rollout-terminal-history';
import { resumeConversation } from '@main/core/conversations/resumeConversation';
import { mapConversationRowToConversation } from '@main/core/conversations/utils';
import { db } from '@main/db/client';
import { conversations, projects } from '@main/db/schema';
import { log } from '@main/lib/logger';
import { taskManager } from '../tasks/task-manager';
import { workspaceRegistry } from '../workspaces/workspace-registry';
import { exportTerminalLog } from './export-terminal-log';
import { ptySessionRegistry } from './pty-session-registry';
import { normalizePlainTextTerminalEol } from './terminal-history-eol';

export const ptyController = createRPCController({
  exportTerminalLog,

  /** Send raw input data to a PTY session. */
  sendInput: (sessionId: string, data: string) => {
    let status = ptySessionRegistry.writeOrQueue(sessionId, data);
    if (status === 'unavailable') {
      const parsed = parsePtySessionId(sessionId);
      if (parsed) {
        const registrationEpoch = ptySessionRegistry.beginRegistration(sessionId);
        status = ptySessionRegistry.writeOrQueue(sessionId, data);
        void resumeConversation(parsed.projectId, parsed.scopeId, parsed.leafId).catch((error) => {
          ptySessionRegistry.cancelRegistration(sessionId, registrationEpoch);
          log.debug('ptyController.sendInput: transparent resume skipped', {
            sessionId,
            error: String(error),
          });
        });
      }
    }
    if (status === 'full') return err({ type: 'input_queue_full' as const });
    if (status === 'unavailable') return err({ type: 'not_found' as const });
    return ok({ queued: status === 'queued' });
  },

  /** Resize a PTY session to the given terminal dimensions. */
  resize: (sessionId: string, cols: number, rows: number) => {
    const pty = ptySessionRegistry.get(sessionId);
    if (!pty) return err({ type: 'not_found' as const });
    pty.resize(cols, rows);
    return ok();
  },

  /**
   * Atomically return the ring buffer and register the renderer as a consumer
   * for future IPC delivery. Non-destructive — the ring buffer is kept intact.
   * Called once by the renderer when connecting a FrontendPty to a session.
   */
  subscribe: async (sessionId: string, consumerId: string) => {
    const initialSnapshot = ptySessionRegistry.subscribe(sessionId, consumerId);
    if (initialSnapshot.buffer && isInterruptedCodexTerminal(initialSnapshot.buffer)) {
      const historicalBuffer = await loadHistoricalConversationBuffer(sessionId);
      const latestSnapshot = ptySessionRegistry.subscribe(sessionId, consumerId);

      // The rollout is a stable replay surface only while the same live PTY
      // generation is still at the interrupted screen. If it produced output,
      // restarted, or exited while history was loading, the live watermark
      // remains authoritative and the renderer receives that latest snapshot.
      if (
        historicalBuffer &&
        latestSnapshot.generation === initialSnapshot.generation &&
        latestSnapshot.sequence === initialSnapshot.sequence &&
        ptySessionRegistry.get(sessionId)
      ) {
        return ok({
          buffer: historicalBuffer,
          generation: latestSnapshot.generation,
          sequence: latestSnapshot.sequence,
        });
      }

      return ok(latestSnapshot);
    }
    if (initialSnapshot.buffer || ptySessionRegistry.get(sessionId)) return ok(initialSnapshot);

    const historicalBuffer = await loadHistoricalConversationBuffer(sessionId);
    // The history lookup crosses an async boundary. Re-subscribe atomically so
    // a PTY that registered (and perhaps already exited) in the meantime wins
    // over stale history. Its listener was installed before the first call, so
    // live events remain queued and the returned watermark can deduplicate them.
    const latestSnapshot = ptySessionRegistry.subscribe(sessionId, consumerId);
    if (
      latestSnapshot.generation !== initialSnapshot.generation ||
      latestSnapshot.sequence !== initialSnapshot.sequence ||
      latestSnapshot.buffer ||
      ptySessionRegistry.get(sessionId)
    ) {
      return ok(latestSnapshot);
    }
    return ok({
      buffer: historicalBuffer,
      generation: latestSnapshot.generation,
      sequence: latestSnapshot.sequence,
    });
  },

  /** Cumulative acknowledgement that xterm has parsed an output batch. */
  acknowledgeOutput: (
    sessionId: string,
    consumerId: string,
    generation: number,
    sequence: number
  ) => {
    ptySessionRegistry.acknowledge(sessionId, consumerId, generation, sequence);
    return ok();
  },

  /** Renew a renderer consumer lease and replay its latest parsed watermark. */
  heartbeatConsumer: (
    sessionId: string,
    consumerId: string,
    generation: number,
    acknowledgedSequence: number
  ) => {
    ptySessionRegistry.heartbeat(sessionId, consumerId, generation, acknowledgedSequence);
    return ok();
  },

  /**
   * Remove the renderer's consumer registration for a session.
   * Called when the renderer disposes its FrontendPty.
   */
  unsubscribe: (sessionId: string, consumerId: string) => {
    ptySessionRegistry.unsubscribe(sessionId, consumerId);
    return ok();
  },

  /** Kill a PTY session and clean it up immediately. */
  kill: (sessionId: string) => {
    const pty = ptySessionRegistry.get(sessionId);
    if (pty) {
      try {
        pty.kill();
      } catch (e) {
        log.warn('ptyController.kill: error killing PTY', { sessionId, error: String(e) });
      }
    }
    ptySessionRegistry.unregister(sessionId);
    return ok();
  },

  /**
   * Upload local files into the task's working directory on a remote SSH host
   * and return their remote paths.  Uses the SFTP subsystem of the already-
   * connected ssh2 client — no local ssh/scp binaries are involved.
   *
   * The session ID encodes the project and scope (`projectId:scopeId:leafId`),
   * where `scopeId` is a task ID for conversation uploads.
   */
  uploadFiles: async (args: { sessionId: string; localPaths: string[] }) => {
    try {
      const [projectId, scopeId] = args.sessionId.split(':');
      if (!projectId || !scopeId) return err({ type: 'invalid_session' as const });

      const taskProvider = taskManager.getTask(scopeId);
      if (!taskProvider) return err({ type: 'not_ssh' as const });

      const workspaceId = taskManager.getWorkspaceId(scopeId) ?? '';
      const workspace = workspaceRegistry.get(workspaceId);
      if (!workspace?.fs.copyLocalFile) return err({ type: 'not_ssh' as const });

      const remotePaths = await Promise.all(
        args.localPaths.map(async (localPath) => {
          const remoteName = `${randomUUID()}-${basename(localPath)}`;
          await workspace.fs.copyLocalFile!(localPath, remoteName);
          return `${workspace.path}/${remoteName}`;
        })
      );
      return ok({ remotePaths });
    } catch (e: unknown) {
      log.error('pty:uploadFiles failed', {
        sessionId: args.sessionId,
        error: (e as Error)?.message || e,
      });
      return err({ type: 'upload_failed' as const, message: String((e as Error)?.message || e) });
    }
  },
});

function isInterruptedCodexTerminal(buffer: string): boolean {
  return /conversation interrupted[\s\S]{0,180}tell the model what to do differently/i.test(buffer);
}

async function loadHistoricalConversationBuffer(sessionId: string): Promise<string> {
  const parsed = parsePtySessionId(sessionId);
  if (!parsed) return '';

  const [row] = await db
    .select({
      conversation: conversations,
      projectPath: projects.path,
      projectWorkspaceProvider: projects.workspaceProvider,
    })
    .from(conversations)
    .innerJoin(projects, eq(projects.id, conversations.projectId))
    .where(
      and(
        eq(conversations.projectId, parsed.projectId),
        eq(conversations.taskId, parsed.scopeId),
        eq(conversations.id, parsed.leafId)
      )
    )
    .limit(1);

  if (!row || row.projectWorkspaceProvider !== 'local') return '';

  const conversation = mapConversationRowToConversation(row.conversation);
  if (conversation.runtimeId !== 'codex') return '';

  const workspaceId = taskManager.getWorkspaceId(parsed.scopeId);
  const cwd = (workspaceId ? workspaceRegistry.get(workspaceId)?.path : null) ?? row.projectPath;

  try {
    const history =
      (await loadCodexRolloutTerminalHistoryForConversation({
        conversation,
        cwd,
      })) ?? '';
    return normalizePlainTextTerminalEol(history);
  } catch (error) {
    log.warn('ptyController.subscribe: failed to load Codex rollout history', {
      sessionId,
      conversationId: parsed.leafId,
      error: String(error),
    });
    return '';
  }
}
