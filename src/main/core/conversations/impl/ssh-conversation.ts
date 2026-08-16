import type { AgentSessionConfig } from '@shared/agent-session';
import {
  mergeSessionRuntimeOverrides,
  type Conversation,
  type SessionRuntimeOverrides,
} from '@shared/conversations';
import { agentSessionExitedChannel } from '@shared/events/agentEvents';
import type { ProjectPromptPrinciples } from '@shared/project-settings';
import { makePtySessionId, parsePtySessionId } from '@shared/ptySessionId';
import { wireAgentClassifier } from '@main/core/agent-hooks/classifier-wiring';
import { claudeTrustService } from '@main/core/agent-hooks/claude-trust-service';
import { codexTrustService } from '@main/core/agent-hooks/codex-trust-service';
import { agentSessionRuntimeStore } from '@main/core/conversations/agent-session-runtime';
import { agentSilenceReconciler } from '@main/core/conversations/agent-silence-reconciler';
import { createClaudeInterruptSniffer } from '@main/core/conversations/claude-interrupt-sniffer';
import type {
  ActiveConversationSession,
  ConversationProvider,
  ConversationStartOptions,
} from '@main/core/conversations/types';
import type { IExecutionContext } from '@main/core/execution-context/types';
import { SshFileSystem } from '@main/core/fs/impl/ssh-fs';
import { captureAgentExitTail, describeAgentExit } from '@main/core/pty/agent-exit-diagnostics';
import type { Pty } from '@main/core/pty/pty';
import { ptySessionRegistry } from '@main/core/pty/pty-session-registry';
import { resolveSshCommand } from '@main/core/pty/spawn-utils';
import { openSsh2Pty } from '@main/core/pty/ssh2-pty';
import { resolveAvailableTmuxSessionName } from '@main/core/pty/tmux-availability';
import { TmuxReattachMissError, waitForTmuxReattach } from '@main/core/pty/tmux-reattach';
import {
  killTmuxSession,
  listTmuxSessionMarkersStrict,
  sendLiteralToTmuxSession,
  type TmuxSessionMarker,
} from '@main/core/pty/tmux-session-name';
import { resolveTerminalThemeMode } from '@main/core/settings/resolve-terminal-theme-mode';
import { runtimeOverrideSettings } from '@main/core/settings/runtime-settings-service';
import type { SshClientProxy } from '@main/core/ssh/ssh-client-proxy';
import { events } from '@main/lib/events';
import { log } from '@main/lib/logger';
import { telemetryService } from '@main/lib/telemetry';
import {
  cancelConversationHydrationBarrier,
  cancelConversationHydrationBarriersForTask,
} from '../conversation-hydration-barrier';
import {
  recordConversationAuthProvider,
  snapshotConversationUsageOnSessionExit,
  snapshotTaskDiffOnSessionExit,
} from '../session-stats-hooks';
import { buildAgentCommand } from './agent-command';
import { buildAppendSystemPrompt } from './append-system-prompt';
import { substituteImageMentions } from './image-attachments';
import { classifyLostPtyTransport, type PtyExitClassification } from './pty-exit-classification';
import { resolveRuntimeEnv, resolveRuntimeTmuxEnv } from './runtime-env';
import { injectTuiStartupInput } from './tui-startup-input';

const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;

export class SshConversationProvider implements ConversationProvider {
  private sessions = new Map<string, Pty>();
  private knownSessionIds = new Set<string>();
  private readonly intentionallyDetachedPtys = new WeakSet<Pty>();
  private readonly pendingStarts = new Map<string, { token: symbol; completion: Promise<void> }>();
  private readonly projectId: string;
  private readonly sidebarWorkspaceId?: string | null;
  readonly taskPath: string;
  private readonly taskId: string;
  private readonly taskEnvVars: Record<string, string>;
  private readonly tmux: boolean = false;
  private readonly shellSetup?: string;
  private readonly ctx: IExecutionContext;
  private readonly proxy: SshClientProxy;
  private readonly connectionId: string;
  private readonly resolveProjectPromptPrinciples?: () => Promise<
    ProjectPromptPrinciples | undefined
  >;
  private readonly resolveFacetInstructions?: () => Promise<string | undefined>;
  private readonly tmuxSessionNames = new Map<string, string>();
  private readonly transportDetachedAt = new Map<string, number>();
  private readonly inputTails = new Map<string, Promise<void>>();
  private readonly sessionInfos = new Map<string, Omit<ActiveConversationSession, 'detachable'>>();
  private readonly silenceReconcilerDetachers = new Map<string, () => void>();

  constructor({
    projectId,
    sidebarWorkspaceId,
    taskPath,
    taskId,
    taskEnvVars = {},
    tmux = false,
    shellSetup,
    ctx,
    proxy,
    connectionId,
    resolveProjectPromptPrinciples,
    resolveFacetInstructions,
  }: {
    projectId: string;
    sidebarWorkspaceId?: string | null;
    taskPath: string;
    taskId: string;
    taskEnvVars?: Record<string, string>;
    tmux?: boolean;
    shellSetup?: string;
    ctx: IExecutionContext;
    proxy: SshClientProxy;
    connectionId: string;
    resolveProjectPromptPrinciples?: () => Promise<ProjectPromptPrinciples | undefined>;
    resolveFacetInstructions?: () => Promise<string | undefined>;
  }) {
    this.projectId = projectId;
    this.sidebarWorkspaceId = sidebarWorkspaceId;
    this.taskPath = taskPath;
    this.taskId = taskId;
    this.taskEnvVars = taskEnvVars;
    this.tmux = tmux;
    this.shellSetup = shellSetup;
    this.ctx = ctx;
    this.proxy = proxy;
    this.connectionId = connectionId;
    this.resolveProjectPromptPrinciples = resolveProjectPromptPrinciples;
    this.resolveFacetInstructions = resolveFacetInstructions;
  }

  async startSession(
    conversation: Conversation,
    initialSize: { cols: number; rows: number } = { cols: DEFAULT_COLS, rows: DEFAULT_ROWS },
    isResuming: boolean = false,
    initialPrompt?: string,
    tmuxOverride?: boolean,
    imagePaths?: string[],
    runtimeOverrides?: SessionRuntimeOverrides,
    startOptions?: ConversationStartOptions
  ): Promise<void> {
    const sessionId = makePtySessionId(
      conversation.projectId,
      conversation.taskId,
      conversation.id
    );
    const reattachExistingTmuxSession = startOptions?.reattachExistingTmuxSession === true;
    this.knownSessionIds.add(sessionId);

    if (this.sessions.has(sessionId)) return;
    const existingStart = this.pendingStarts.get(sessionId);
    if (existingStart) return existingStart.completion;
    const performanceTrace = startOptions?.performanceTrace;
    const providerStartedAt = performanceTrace?.startSpan();

    const startToken = Symbol(sessionId);
    let resolveCompletion!: () => void;
    let rejectCompletion!: (error: unknown) => void;
    const completion = new Promise<void>((resolve, reject) => {
      resolveCompletion = resolve;
      rejectCompletion = reject;
    });
    void completion.catch(() => {});
    this.pendingStarts.set(sessionId, { token: startToken, completion });

    const registrationEpoch = ptySessionRegistry.beginRegistration(sessionId);
    let registrationAttempted = false;
    let registrationCompleted = false;
    let startCommitted = false;
    let startFailed = false;
    let spawnedPty: Pty | undefined;
    let detachSilenceReconcilerForRollback: (() => void) | undefined;
    let reattachMarkerBaseline: TmuxSessionMarker | undefined;

    try {
      await claudeTrustService.maybeAutoTrustSsh({
        runtimeId: conversation.runtimeId,
        cwd: this.taskPath,
        ctx: this.ctx,
        remoteFs: new SshFileSystem(this.proxy, '/'),
      });
      if (!this.ownsPendingStart(sessionId, startToken)) return;

      const providerConfig = await runtimeOverrideSettings.getItem(conversation.runtimeId);
      if (!this.ownsPendingStart(sessionId, startToken)) return;
      if (conversation.runtimeId === 'codex') {
        await codexTrustService.maybeAutoTrustSsh({
          runtimeId: conversation.runtimeId,
          cwd: this.taskPath,
          codexHome: resolveRuntimeEnv(providerConfig, {
            runtimeId: conversation.runtimeId,
          })?.CODEX_HOME,
          ctx: this.ctx,
          remoteFs: new SshFileSystem(this.proxy, '/'),
        });
        if (!this.ownsPendingStart(sessionId, startToken)) return;
      }
      recordConversationAuthProvider(conversation.id, providerConfig);
      if (conversation.skillPolicy) {
        log.warn('Skipping local Agent skill profile for SSH conversation', {
          conversationId: conversation.id,
          runtimeId: conversation.runtimeId,
        });
      }
      const appendSystemPrompt = await buildAppendSystemPrompt({
        resolveFacetInstructions: this.resolveFacetInstructions,
        resolveProjectPromptPrinciples: this.resolveProjectPromptPrinciples,
        target: { projectId: this.projectId, workspaceId: this.sidebarWorkspaceId },
        executionMode: conversation.executionMode,
      });
      if (!this.ownsPendingStart(sessionId, startToken)) return;
      const terminalThemeMode = await resolveTerminalThemeMode();
      if (!this.ownsPendingStart(sessionId, startToken)) return;
      const effectiveRuntimeOverrides = mergeSessionRuntimeOverrides(
        conversation.runtimeOverrides,
        runtimeOverrides
      );
      const { permissionMode: runtimePermissionMode, ...runtimeCommandOverrides } =
        effectiveRuntimeOverrides ?? {};
      const { command, args, startupInput } = buildAgentCommand({
        runtimeId: conversation.runtimeId,
        providerConfig,
        autoApprove: conversation.autoApprove,
        permissionMode: runtimePermissionMode ?? conversation.permissionMode,
        sessionId: conversation.id,
        isResuming,
        // Clipboard paste is local-only; remote sessions get @path mentions.
        initialPrompt: isResuming
          ? initialPrompt
          : substituteImageMentions(initialPrompt, imagePaths ?? []),
        appendSystemPrompt,
        ...runtimeCommandOverrides,
        terminalThemeMode,
        executionMode: conversation.executionMode,
      });

      const retainedTmuxSessionName = reattachExistingTmuxSession
        ? this.tmuxSessionNames.get(sessionId)
        : undefined;
      const tmuxSessionName =
        retainedTmuxSessionName ?? (await this.resolveTmuxSessionName(sessionId, tmuxOverride));
      if (!this.ownsPendingStart(sessionId, startToken)) return;
      if (reattachExistingTmuxSession) {
        if (!tmuxSessionName) throw new TmuxReattachMissError();
        const markers = performanceTrace
          ? await performanceTrace.measure(
              'tmux-marker-probe',
              () => listTmuxSessionMarkersStrict(this.ctx),
              (result) => ({
                markerCount: result.length,
                reattachExisting: true,
                transport: 'ssh',
              })
            )
          : await listTmuxSessionMarkersStrict(this.ctx);
        if (!this.ownsPendingStart(sessionId, startToken)) return;
        reattachMarkerBaseline = markers.find((marker) => marker.sessionName === tmuxSessionName);
        if (!reattachMarkerBaseline) throw new TmuxReattachMissError();
      }
      const providerEnv = resolveRuntimeEnv(providerConfig, {
        runtimeId: conversation.runtimeId,
        tmuxEnabled: Boolean(tmuxSessionName),
      });

      const cfg: AgentSessionConfig = {
        taskId: this.taskId,
        conversationId: conversation.id,
        runtimeId: conversation.runtimeId,
        command,
        args,
        cwd: this.taskPath,
        shellSetup: this.shellSetup,
        tmuxSessionName,
        tmuxEnv: resolveRuntimeTmuxEnv(providerEnv),
        tmuxSessionIdentity: conversation.id,
        tmuxReattachExistingSession: reattachExistingTmuxSession,
        autoApprove: conversation.autoApprove ?? false,
        resume: isResuming,
      };

      const profile = await this.proxy.getRemoteShellProfile();
      if (!this.ownsPendingStart(sessionId, startToken)) return;
      const sshCommand = resolveSshCommand(
        'agent',
        cfg,
        { ...providerEnv, ...this.taskEnvVars },
        profile
      );

      if (
        !(await ptySessionRegistry.waitForRevealClaims(sessionId, registrationEpoch)) ||
        !this.ownsPendingStart(sessionId, startToken)
      ) {
        return;
      }

      if (providerStartedAt !== undefined) {
        performanceTrace?.endSpan('provider-preflight', providerStartedAt, {
          runtimeId: conversation.runtimeId,
          tmuxEnabled: Boolean(tmuxSessionName),
          reattachExisting: reattachExistingTmuxSession,
          transport: 'ssh',
        });
      }
      const openPty = () =>
        openSsh2Pty(this.proxy.client, {
          id: sessionId,
          command: sshCommand,
          cols: initialSize.cols,
          rows: initialSize.rows,
        });
      const result = performanceTrace
        ? await performanceTrace.measure('provider-spawn', openPty, {
            runtimeId: conversation.runtimeId,
            tmuxEnabled: Boolean(tmuxSessionName),
            reattachExisting: reattachExistingTmuxSession,
            transport: 'ssh',
          })
        : await openPty();

      if (!this.ownsPendingStart(sessionId, startToken)) {
        if (result.success) {
          try {
            result.data.kill();
          } catch {}
        }
        return;
      }
      if (!result.success) {
        log.error('SshConversationProvider: failed to open SSH channel', {
          sessionId,
          error: result.error.message,
        });
        throw new Error(`Failed to open SSH channel: ${result.error.message}`);
      }

      const pty = result.data;
      spawnedPty = pty;
      const performanceAttempt = reattachExistingTmuxSession ? 'reattach' : 'resume';
      let firstOutputTrace = performanceTrace;
      pty.onData((data) => {
        if (!firstOutputTrace || data.length === 0) return;
        const outputTrace = firstOutputTrace;
        firstOutputTrace = undefined;
        outputTrace.mark('pty-first-output', {
          attempt: performanceAttempt,
          byteLength: Buffer.byteLength(data, 'utf8'),
          reattachExisting: reattachExistingTmuxSession,
          runtimeId: conversation.runtimeId,
          transport: 'ssh',
        });
      });
      const tmuxReattachPromise = reattachMarkerBaseline
        ? waitForTmuxReattach({ ctx: this.ctx, pty, baseline: reattachMarkerBaseline })
        : undefined;
      const startupInputPromise =
        startupInput && !reattachExistingTmuxSession
          ? injectTuiStartupInput({ pty, runtimeId: conversation.runtimeId, input: startupInput })
          : undefined;
      void startupInputPromise?.catch(() => {});
      void tmuxReattachPromise?.catch(() => {});

      // hooks not supported yet, rely on classifier for visual indicator
      wireAgentClassifier({
        pty,
        runtimeId: conversation.runtimeId,
        projectId: conversation.projectId,
        taskId: conversation.taskId,
        conversationId: conversation.id,
      });

      const detachSilenceReconciler = agentSilenceReconciler.attach(sessionId, {
        projectId: conversation.projectId,
        taskId: conversation.taskId,
        conversationId: conversation.id,
      });
      this.silenceReconcilerDetachers.set(sessionId, detachSilenceReconciler);
      detachSilenceReconcilerForRollback = detachSilenceReconciler;
      pty.onData(() => agentSilenceReconciler.noteOutput(sessionId));
      if (conversation.runtimeId === 'claude' || conversation.runtimeId === 'codex') {
        // Sub-second Esc-interrupt detection from the TUI's interruption line.
        pty.onData(
          createClaudeInterruptSniffer({
            projectId: conversation.projectId,
            taskId: conversation.taskId,
            conversationId: conversation.id,
            ptySessionId: sessionId,
          })
        );
      }

      // A dead PTY only proves the transport died: for a tmux-backed session the
      // Agent runs inside the remote tmux pane and outlives every client. Ask
      // tmux before reporting an Agent exit, otherwise a wrapper death clears
      // `working` while the provider CLI is still mid-turn.
      let exitClassification: Promise<PtyExitClassification> | null = null;
      let exitedBeforeCommit = false;
      pty.onExit(({ exitCode, signal }) => {
        if (this.intentionallyDetachedPtys.delete(pty)) {
          this.releaseSilenceReconciler(sessionId, detachSilenceReconciler);
          return;
        }
        if (!startCommitted) exitedBeforeCommit = true;
        this.releaseSilenceReconciler(sessionId, detachSilenceReconciler);
        if (this.sessions.get(sessionId) !== pty) return;
        // A CLI that dies mid-turn writes no API error and no crash report, so
        // its last screen is the only evidence of why the turn stopped. Exit
        // finalization clears the replay ring buffer, hence the snapshot here,
        // synchronously, before the asynchronous tmux probe below.
        const exitTail = captureAgentExitTail(sessionId);
        const exitReason = describeAgentExit({ exitCode, signal });
        // The transport is gone either way, so stop routing input into a dead
        // channel before the probe resolves; `sendInput` falls back to headless
        // `tmux send-keys` exactly as it does for an idle detach.
        this.sessions.delete(sessionId);
        exitClassification = classifyLostPtyTransport(
          this.ctx,
          this.tmuxSessionNames.get(sessionId)
        ).then((verdict) => {
          if (verdict === 'transport-lost') {
            this.transportDetachedAt.set(sessionId, Date.now());
            log.warn('SshConversation: PTY transport died while the tmux agent stayed alive', {
              sessionId,
              conversationId: conversation.id,
              exitCode,
            });
            return verdict;
          }
          // A replacement transport that registered while the probe was in
          // flight owns the run state now.
          if (this.sessions.has(sessionId)) return 'transport-lost';
          log.warn('SshConversation: agent CLI exited', {
            sessionId,
            conversationId: conversation.id,
            runtimeId: conversation.runtimeId,
            exitReason,
            exitTail: exitTail || '(no output captured)',
          });
          this.sessionInfos.delete(sessionId);
          markRuntimeSessionExited({
            projectId: conversation.projectId,
            taskId: conversation.taskId,
            conversationId: conversation.id,
          });
          telemetryService.capture('agent_run_finished', {
            provider: conversation.runtimeId,
            exit_code: typeof exitCode === 'number' ? exitCode : -1,
            project_id: conversation.projectId,
            task_id: conversation.taskId,
            conversation_id: conversation.id,
          });
          return verdict;
        });
      });

      if (!this.ownsPendingStart(sessionId, startToken)) return;
      registrationAttempted = true;
      const registerPty = () =>
        ptySessionRegistry.register(sessionId, pty, {
          onFinalExit: (info, generation) => {
            const classification = exitClassification;
            if (!classification) return;
            void classification.then((verdict) => {
              if (verdict !== 'agent-exited') return;
              events.emit(agentSessionExitedChannel, {
                sessionId,
                projectId: conversation.projectId,
                conversationId: conversation.id,
                taskId: conversation.taskId,
                generation,
                exitCode: info.exitCode,
              });
              snapshotConversationUsageOnSessionExit(conversation.id);
              snapshotTaskDiffOnSessionExit(conversation.taskId);
            });
          },
          registrationEpoch,
          tmuxBacked: Boolean(tmuxSessionName),
          initialDimensions: initialSize,
          onRendererIdle: tmuxSessionName
            ? (generation) => this.detachRendererTransport(sessionId, pty, generation)
            : undefined,
        });
      if (performanceTrace) {
        performanceTrace.measureSync('pty-registered', registerPty, () => ({
          generation: ptySessionRegistry.getGeneration(sessionId),
          runtimeId: conversation.runtimeId,
          transport: 'ssh',
        }));
      } else {
        registerPty();
      }
      registrationCompleted = true;
      if (!this.ownsPendingStart(sessionId, startToken)) {
        ptySessionRegistry.unregister(sessionId);
        return;
      }
      if (tmuxReattachPromise) {
        if (performanceTrace) {
          await performanceTrace.measure('tmux-reattach-confirm', () => tmuxReattachPromise, {
            runtimeId: conversation.runtimeId,
            transport: 'ssh',
          });
        } else {
          await tmuxReattachPromise;
        }
        if (!this.ownsPendingStart(sessionId, startToken)) return;
      } else {
        performanceTrace?.mark('tmux-reattach-confirm', {
          skipped: true,
          durationMs: 0,
          transport: 'ssh',
        });
      }
      this.sessions.set(sessionId, pty);
      this.sessionInfos.set(sessionId, {
        sessionId,
        conversationId: conversation.id,
        projectId: conversation.projectId,
        taskId: conversation.taskId,
        runtimeId: conversation.runtimeId,
        title: conversation.title,
      });
      // Reattaching the SSH transport does not mean the Agent became idle. A
      // resumed tmux process can still be working even though this invocation has
      // no new prompt, so only publish a run-state transition for submitted input.
      if (initialPrompt?.trim()) {
        agentSessionRuntimeStore.setStatus(
          {
            projectId: conversation.projectId,
            taskId: conversation.taskId,
            conversationId: conversation.id,
          },
          'working'
        );
      }
      // Ssh2PtySession replays a close received during channel open in a
      // microtask after onExit subscribes. Do not acknowledge startup until
      // that replay has had a chance to invalidate the just-registered PTY.
      await Promise.resolve();
      if (!this.ownsPendingStart(sessionId, startToken)) return;
      if (exitedBeforeCommit || this.sessions.get(sessionId) !== pty) {
        throw new Error(`${conversation.runtimeId} exited during SSH startup.`);
      }
      if (startupInputPromise) {
        const delivered = await startupInputPromise;
        if (!this.ownsPendingStart(sessionId, startToken)) return;
        if (!delivered) throw new Error(`${conversation.runtimeId} exited before startup input.`);
      }
      if (tmuxSessionName) {
        this.tmuxSessionNames.set(sessionId, tmuxSessionName);
      } else {
        this.tmuxSessionNames.delete(sessionId);
      }
      this.transportDetachedAt.delete(sessionId);
      telemetryService.capture('agent_run_started', {
        provider: conversation.runtimeId,
        project_id: conversation.projectId,
        task_id: conversation.taskId,
        conversation_id: conversation.id,
      });
      startCommitted = true;
      if (providerStartedAt !== undefined) {
        performanceTrace?.endSpan('provider-committed', providerStartedAt, {
          generation: ptySessionRegistry.getGeneration(sessionId),
          runtimeId: conversation.runtimeId,
          tmuxEnabled: Boolean(tmuxSessionName),
          reattachExisting: reattachExistingTmuxSession,
          transport: 'ssh',
        });
      }
    } catch (error) {
      startFailed = true;
      rejectCompletion(error);
      throw error;
    } finally {
      const ownsStart = this.ownsPendingStart(sessionId, startToken);
      if (!startCommitted && spawnedPty) {
        if (this.sessions.get(sessionId) === spawnedPty) {
          this.sessions.delete(sessionId);
        }
        this.releaseSilenceReconciler(sessionId, detachSilenceReconcilerForRollback);
        try {
          spawnedPty.kill();
        } catch {}
        if (ownsStart && registrationAttempted) {
          ptySessionRegistry.unregister(sessionId);
        }
      }
      if (!registrationCompleted) {
        ptySessionRegistry.cancelRegistration(sessionId, registrationEpoch);
      }
      if (ownsStart) this.pendingStarts.delete(sessionId);
      if (!startFailed) resolveCompletion();
    }
  }

  private resolveTmuxSessionName(
    sessionId: string,
    tmuxOverride?: boolean
  ): Promise<string | undefined> {
    return resolveAvailableTmuxSessionName({
      auto: false,
      connectionId: this.connectionId,
      ctx: this.ctx,
      requested: tmuxOverride ?? this.tmux,
      sessionId,
      source: 'SshConversationProvider',
    });
  }

  getActiveSessionCount(): number {
    return this.sessions.size;
  }

  getDetachableSessionCount(): number {
    let count = 0;
    for (const sessionId of this.sessions.keys()) {
      if (this.tmuxSessionNames.has(sessionId)) count += 1;
    }
    return count;
  }

  getActiveSessions(): ActiveConversationSession[] {
    return Array.from(this.sessionInfos.entries()).map(([sessionId, info]) => {
      const transportAttached = this.sessions.has(sessionId);
      const { pid, ...base } = info;
      return {
        ...base,
        ...(transportAttached && pid !== undefined ? { pid } : {}),
        detachable: this.tmuxSessionNames.has(sessionId),
        ...(transportAttached
          ? {}
          : {
              transportAttached: false as const,
              transportDetachedAt: this.transportDetachedAt.get(sessionId),
            }),
      };
    });
  }

  /**
   * Ask the tmux pane — not the attach channel — whether the agent still runs.
   * A detached transport is Yoda's own doing and says nothing about the agent.
   */
  async isAgentBackendAlive(conversationId: string): Promise<boolean> {
    const sessionId = makePtySessionId(this.projectId, this.taskId, conversationId);
    if (this.sessions.has(sessionId)) return true;
    const tmuxSessionName = this.tmuxSessionNames.get(sessionId);
    if (!tmuxSessionName) return false;
    return (await classifyLostPtyTransport(this.ctx, tmuxSessionName)) === 'transport-lost';
  }

  /** Release only the current SSH tmux attach channel after registry revalidation. */
  private detachRendererTransport(sessionId: string, pty: Pty, generation: number): void {
    if (this.sessions.get(sessionId) !== pty || !this.tmuxSessionNames.has(sessionId)) return;
    if (!ptySessionRegistry.detachRendererTransport(sessionId, generation, pty)) return;

    this.intentionallyDetachedPtys.add(pty);
    this.sessions.delete(sessionId);
    this.transportDetachedAt.set(sessionId, Date.now());
    this.releaseSilenceReconciler(sessionId);
    try {
      pty.kill();
    } catch (error) {
      log.warn('SshConversation: failed to detach idle tmux transport', {
        sessionId,
        generation,
        error: String(error),
      });
    }
  }

  async sendInput(conversationId: string, data: string): Promise<boolean> {
    const sessionId = makePtySessionId(this.projectId, this.taskId, conversationId);
    // Protect newly queued headless input from the idle-session sweep before
    // the asynchronous tmux send-keys process reaches the head of its queue.
    if (!this.sessions.has(sessionId) && this.tmuxSessionNames.has(sessionId)) {
      this.transportDetachedAt.set(sessionId, Date.now());
    }
    let delivered = false;
    const previous = this.inputTails.get(sessionId) ?? Promise.resolve();
    const delivery = previous
      .catch(() => {})
      .then(async () => {
        const pty = this.sessions.get(sessionId);
        if (pty) {
          pty.write(data);
          delivered = true;
          return;
        }
        const tmuxSessionName = this.tmuxSessionNames.get(sessionId);
        if (!tmuxSessionName) return;
        this.transportDetachedAt.set(sessionId, Date.now());
        await sendLiteralToTmuxSession(this.ctx, tmuxSessionName, data);
        delivered = true;
      });
    const tail = delivery.then(
      () => {},
      () => {}
    );
    this.inputTails.set(sessionId, tail);
    try {
      await delivery;
      return delivered;
    } finally {
      if (this.inputTails.get(sessionId) === tail) this.inputTails.delete(sessionId);
    }
  }

  private ownsPendingStart(sessionId: string, token: symbol): boolean {
    return this.pendingStarts.get(sessionId)?.token === token;
  }

  private cancelAllPendingStarts(): void {
    for (const sessionId of this.pendingStarts.keys()) {
      const conversationId = parsePtySessionId(sessionId)?.leafId;
      if (conversationId) {
        cancelConversationHydrationBarrier(this.projectId, this.taskId, conversationId);
      }
      this.pendingStarts.delete(sessionId);
      ptySessionRegistry.unregister(sessionId);
    }
  }

  private releaseSilenceReconciler(sessionId: string, expected?: () => void): void {
    const detach = this.silenceReconcilerDetachers.get(sessionId);
    if (!detach || (expected && detach !== expected)) return;
    this.silenceReconcilerDetachers.delete(sessionId);
    detach();
  }

  async stopSession(conversationId: string): Promise<void> {
    const sessionId = makePtySessionId(this.projectId, this.taskId, conversationId);
    cancelConversationHydrationBarrier(this.projectId, this.taskId, conversationId);
    this.knownSessionIds.delete(sessionId);
    this.pendingStarts.delete(sessionId);
    this.releaseSilenceReconciler(sessionId);
    const pty = this.sessions.get(sessionId);
    if (pty) {
      try {
        pty.kill();
      } catch (e) {
        log.warn('SshConversation: error killing PTY', { sessionId, error: String(e) });
      }
      this.sessions.delete(sessionId);
    }
    ptySessionRegistry.unregister(sessionId);
    this.sessionInfos.delete(sessionId);
    this.transportDetachedAt.delete(sessionId);
    this.inputTails.delete(sessionId);
    markRuntimeSessionExited({
      projectId: this.projectId,
      taskId: this.taskId,
      conversationId,
    });
    const tmuxSessionName = this.tmuxSessionNames.get(sessionId);
    this.tmuxSessionNames.delete(sessionId);
    if (tmuxSessionName) {
      await killTmuxSession(this.ctx, tmuxSessionName);
    }
  }

  async destroyAll(): Promise<void> {
    const sessionIds = Array.from(this.knownSessionIds);
    const tmuxSessionNames = sessionIds.flatMap((id) => {
      const name = this.tmuxSessionNames.get(id);
      return name ? [name] : [];
    });
    await this.detachAll();
    await Promise.all(tmuxSessionNames.map((name) => killTmuxSession(this.ctx, name)));
    this.knownSessionIds.clear();
    this.tmuxSessionNames.clear();
    this.transportDetachedAt.clear();
    this.inputTails.clear();
    this.sessionInfos.clear();
  }

  async detachAll(): Promise<void> {
    cancelConversationHydrationBarriersForTask(this.projectId, this.taskId);
    this.cancelAllPendingStarts();
    for (const sessionId of Array.from(this.silenceReconcilerDetachers.keys())) {
      this.releaseSilenceReconciler(sessionId);
    }
    for (const [sessionId, pty] of this.sessions) {
      try {
        pty.kill();
      } catch {}
      ptySessionRegistry.unregister(sessionId);
    }
    for (const info of this.sessionInfos.values()) {
      agentSessionRuntimeStore.remove(info);
    }
    this.sessions.clear();
    this.transportDetachedAt.clear();
    this.inputTails.clear();
    this.sessionInfos.clear();
  }
}

function markRuntimeSessionExited(session: {
  projectId: string;
  taskId: string;
  conversationId: string;
}): void {
  agentSessionRuntimeStore.dispatch(
    session,
    { kind: 'process-exited', at: Date.now() },
    'process-exited'
  );
  agentSessionRuntimeStore.remove(session);
}
