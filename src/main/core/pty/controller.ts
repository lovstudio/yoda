import { randomUUID } from 'node:crypto';
import { basename } from 'node:path';
import type { WebContents } from 'electron';
import { createEventRPCProcedure, createRPCController } from '@shared/ipc/rpc';
import type { PtyRenderCheckpoint } from '@shared/pty-render-checkpoint';
import { parsePtySessionId } from '@shared/ptySessionId';
import { err, ok } from '@shared/result';
import { resumeConversation } from '@main/core/conversations/resumeConversation';
import { log } from '@main/lib/logger';
import { taskManager } from '../tasks/task-manager';
import { workspaceRegistry } from '../workspaces/workspace-registry';
import { exportTerminalLog } from './export-terminal-log';
import { ptySessionRegistry } from './pty-session-registry';

const trackedConsumerOwners = new WeakSet<WebContents>();

function trackConsumerOwner(sender: WebContents | undefined): number | null {
  if (!sender || sender.isDestroyed()) return null;
  if (!trackedConsumerOwners.has(sender)) {
    trackedConsumerOwners.add(sender);
    const releaseOwnedConsumers = () => ptySessionRegistry.unsubscribeOwner(sender.id);
    sender.on('did-start-loading', releaseOwnedConsumers);
    sender.on('render-process-gone', releaseOwnedConsumers);
    sender.on('destroyed', releaseOwnedConsumers);
  }
  return sender.id;
}

export const ptyController = createRPCController({
  exportTerminalLog,

  /** Send raw input data to a PTY session. */
  sendInput: async (sessionId: string, data: string) => {
    let status = ptySessionRegistry.writeOrQueue(sessionId, data);
    if (status === 'unavailable') {
      const parsed = parsePtySessionId(sessionId);
      if (parsed) {
        const conversationProvider = taskManager.getTask(parsed.scopeId)?.conversations;
        const detachedTmuxSession = conversationProvider
          ?.getActiveSessions()
          .some(
            (session) =>
              session.conversationId === parsed.leafId &&
              session.detachable &&
              session.transportAttached === false
          );
        if (detachedTmuxSession && conversationProvider) {
          try {
            if (await conversationProvider.sendInput(parsed.leafId, data)) {
              return ok({ queued: false });
            }
          } catch (error) {
            // The pane may have ended during its headless interval. Fall through
            // to durable resume with the original bytes still available below.
            log.debug('ptyController.sendInput: detached tmux delivery missed', {
              sessionId,
              error: String(error),
            });
          }
        }
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
    const resized = ptySessionRegistry.resizeCurrent(sessionId, cols, rows);
    if (resized) return ok();

    const diagnostics = ptySessionRegistry.getDiagnostics(sessionId);
    if (diagnostics?.live !== true) return err({ type: 'not_found' as const });
    return err({ type: 'resize_failed' as const });
  },

  /** Resize only when the renderer still owns the live PTY generation. */
  resizeForRenderer: (
    sessionId: string,
    expectedGeneration: number,
    cols: number,
    rows: number
  ) => {
    const resized = ptySessionRegistry.resizeForRenderer(sessionId, expectedGeneration, cols, rows);
    if (resized) return ok(resized);

    const diagnostics = ptySessionRegistry.getDiagnostics(sessionId);
    if (diagnostics?.live !== true) return err({ type: 'not_found' as const });
    if (ptySessionRegistry.getGeneration(sessionId) !== expectedGeneration) {
      return err({ type: 'generation_mismatch' as const });
    }
    return err({ type: 'resize_failed' as const });
  },

  /**
   * Atomically return the ring buffer and register the renderer as a consumer
   * for future IPC delivery. Non-destructive — the ring buffer is kept intact.
   * Called once by the renderer when connecting a FrontendPty to a session.
   */
  subscribe: createEventRPCProcedure(async (event, sessionId: string, consumerId: string) => {
    const initialSnapshot = await ptySessionRegistry.subscribeForRenderer(
      sessionId,
      consumerId,
      trackConsumerOwner(event?.sender)
    );
    const hasPendingRegistration = () =>
      ptySessionRegistry.getDiagnostics(sessionId)?.registering === true;
    const initialLive = ptySessionRegistry.get(sessionId) !== undefined;
    const initialRegistering = hasPendingRegistration();
    log.debug('[pty-subscribe] initial snapshot', {
      sessionId,
      generation: initialSnapshot.generation,
      sequence: initialSnapshot.sequence,
      snapshotCharacters: initialSnapshot.buffer.length,
      compactCheckpoint: initialSnapshot.checkpointDimensions !== undefined,
      live: initialLive,
      registering: initialRegistering,
    });
    // A live snapshot is terminal protocol, not transcript text. It remains the
    // only source that can reconstruct the CLI's cursor, colors, and input UI.
    // A session that is already being restored will provide its own live screen;
    // returning transcript text here would append that old screen to the new PTY.
    if (initialSnapshot.buffer || initialLive || initialRegistering) {
      log.debug('[pty-subscribe] resolved without history fallback', {
        sessionId,
        reason: initialSnapshot.buffer ? 'live-buffer' : initialLive ? 'live-pty' : 'registration',
      });
      return ok(initialSnapshot);
    }

    // A transcript is not terminal protocol. Feeding Codex rollout Markdown
    // into xterm here made the same visible surface alternate between two
    // incompatible representations (transcript text, then a reset/live TUI).
    // Session history belongs to the dedicated history UI; the terminal waits
    // for a real PTY generation or a renderer-authored checkpoint only.
    log.debug('[pty-subscribe] no terminal snapshot available', { sessionId });
    return ok(initialSnapshot);
  }),

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

  /**
   * Renew a renderer consumer lease and replay its latest parsed watermark.
   *
   * `known: false` tells the renderer its registration no longer exists, which is
   * the only way it can find out: consumers are released by owner reloads,
   * crashes and lease expiry, none of which the renderer observes.
   */
  heartbeatConsumer: (
    sessionId: string,
    consumerId: string,
    generation: number,
    acknowledgedSequence: number
  ) => {
    return ok(
      ptySessionRegistry.heartbeat(sessionId, consumerId, generation, acknowledgedSequence)
    );
  },

  /**
   * Remove the renderer's consumer registration for a session.
   * Called when the renderer disposes its FrontendPty.
   */
  unsubscribe: (sessionId: string, consumerId: string) => {
    ptySessionRegistry.unsubscribe(sessionId, consumerId);
    return ok();
  },

  /** Persist the current framebuffer and release its renderer consumer atomically. */
  checkpointAndUnsubscribe: (
    sessionId: string,
    consumerId: string,
    checkpoint: PtyRenderCheckpoint
  ) => {
    const saved = ptySessionRegistry.checkpointAndUnsubscribe(sessionId, consumerId, checkpoint);
    log.debug('[DEBUG][agent-session-load] compact checkpoint saved', {
      sessionId,
      generation: checkpoint.generation,
      sequence: checkpoint.sequence,
      checkpointCharacters: checkpoint.buffer.length,
      saved,
    });
    return ok({ saved });
  },

  /**
   * Return the current ownership state for a stable renderer session id.
   *
   * An exit notification can be delivered after a replacement PTY has begun
   * registering under the same id. Renderers use this snapshot to distinguish
   * that stale notification from a process that is genuinely gone.
   */
  getSessionState: (sessionId: string) => {
    const diagnostics = ptySessionRegistry.getDiagnostics(sessionId);
    return {
      generation: ptySessionRegistry.getGeneration(sessionId),
      live: diagnostics?.live === true,
      registering: diagnostics?.registering === true,
    };
  },

  /** Reserve one exact live generation through renderer route commit + paint. */
  claimGenerationReveal: createEventRPCProcedure(
    (event, sessionId: string, consumerId: string, expectedGeneration: number) => {
      const ownerWebContentsId = trackConsumerOwner(event?.sender);
      if (ownerWebContentsId === null) return err({ type: 'owner_unavailable' as const });
      const claim = ptySessionRegistry.claimGenerationReveal(
        sessionId,
        consumerId,
        expectedGeneration,
        ownerWebContentsId
      );
      return claim ? ok(claim) : err({ type: 'not_claimable' as const });
    }
  ),

  /** Release is owner-bound and idempotent; owner teardown also releases it. */
  releaseGenerationReveal: createEventRPCProcedure((event, token: string) => {
    const ownerWebContentsId = event?.sender?.isDestroyed() === false ? event.sender.id : null;
    if (ownerWebContentsId === null) return ok({ released: false });
    return ok({
      released: ptySessionRegistry.releaseGenerationReveal(token, ownerWebContentsId),
    });
  }),

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
