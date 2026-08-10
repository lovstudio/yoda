import { homedir } from 'node:os';
import {
  mergeSessionRuntimeOverrides,
  type Conversation,
  type SessionRuntimeOverrides,
} from '@shared/conversations';
import { agentSessionExitedChannel } from '@shared/events/agentEvents';
import type { ProjectPromptPrinciples } from '@shared/project-settings';
import { makePtyId } from '@shared/ptyId';
import { makePtySessionId } from '@shared/ptySessionId';
import { getRuntime } from '@shared/runtime-registry';
import {
  resolveRuntimeStatusMonitor,
  type RuntimeStatusMonitorId,
} from '@shared/runtime-status-monitor';
import { agentHookService } from '@main/core/agent-hooks/agent-hook-service';
import { makeCodexNotifyCommand } from '@main/core/agent-hooks/agent-notify-command';
import { wireAgentClassifier } from '@main/core/agent-hooks/classifier-wiring';
import { claudeTrustService } from '@main/core/agent-hooks/claude-trust-service';
import { codexTrustService } from '@main/core/agent-hooks/codex-trust-service';
import { HookConfigWriter } from '@main/core/agent-hooks/hook-config';
import { applyHookOverrides } from '@main/core/agent-hooks/inspect/hook-overrides-apply';
import { hookOverridesStore } from '@main/core/agent-hooks/inspect/hook-overrides-store';
import { aiLogService } from '@main/core/ai-logs/ai-log-service';
import { interactiveTurnLogger } from '@main/core/ai-logs/interactive-turn-logger';
import { agentSessionRuntimeStore } from '@main/core/conversations/agent-session-runtime';
import { agentSilenceReconciler } from '@main/core/conversations/agent-silence-reconciler';
import { createClaudeInterruptSniffer } from '@main/core/conversations/claude-interrupt-sniffer';
import { watchClaudeRunState } from '@main/core/conversations/claude-run-state-source';
import { watchClaudeSessionActivity } from '@main/core/conversations/claude-session-activity-source';
import { watchCodexRunState } from '@main/core/conversations/codex-run-state-source';
import { runtimeStatusMonitorRegistry } from '@main/core/conversations/runtime-status-monitor-registry';
import type {
  ActiveConversationSession,
  ConversationProvider,
} from '@main/core/conversations/types';
import type { IExecutionContext } from '@main/core/execution-context/types';
import { LocalFileSystem } from '@main/core/fs/impl/local-fs';
import {
  ensureCodexResumeProviderCompatibleForConfig,
  migrateLegacyCodexMaasHistoryForConfig,
} from '@main/core/maas/codex-history-compat';
import { resolveMaasRuntimeEnv } from '@main/core/maas/runtime-env';
import { spawnLocalPty } from '@main/core/pty/local-pty';
import type { Pty } from '@main/core/pty/pty';
import { buildAgentEnv } from '@main/core/pty/pty-env';
import { ptySessionRegistry } from '@main/core/pty/pty-session-registry';
import { logLocalPtySpawnWarnings, resolveLocalPtySpawn } from '@main/core/pty/pty-spawn-platform';
import { resolveAvailableTmuxSessionName } from '@main/core/pty/tmux-availability';
import { killTmuxSession, sendLiteralToTmuxSession } from '@main/core/pty/tmux-session-name';
import { resolveCodexStatePath } from '@main/core/session-title/codex-title-source';
import { sessionTitleManager } from '@main/core/session-title/session-title-manager';
import { resolveTerminalThemeMode } from '@main/core/settings/resolve-terminal-theme-mode';
import { runtimeOverrideSettings } from '@main/core/settings/runtime-settings-service';
import { appSettingsService } from '@main/core/settings/settings-service';
import { events } from '@main/lib/events';
import { log } from '@main/lib/logger';
import { telemetryService } from '@main/lib/telemetry';
import {
  resolveAgentResumeSessionId,
  resolveCodexThreadIdForConversation,
} from '../codex-session-id';
import { getReservedCodexThreadIds } from '../codex-thread-reservations';
import { ensureCodexThreadUnarchived } from '../codex-unarchive';
import { buildCohubAdapterCommand, getCohubAdapterEnvironment } from '../cohub-adapter-command';
import { getConversationRuntimeStateRoot } from '../conversation-session-source';
import { withExecutionModeInstructions } from '../execution-mode';
import { withRuntimeStateRoot } from '../session-state-roots';
import {
  recordConversationAuthProvider,
  snapshotTaskDiffOnSessionExit,
} from '../session-stats-hooks';
import { buildAgentCommand } from './agent-command';
import { injectClipboardImagesAndPrompt, substituteImageMentions } from './image-attachments';
import { getEnabledPromptPrinciplesText } from './prompt-principles';
import {
  resolveAgentApiEnvVars,
  resolveRuntimeEnv,
  resolveRuntimeStateDirectory,
  resolveRuntimeTmuxEnv,
} from './runtime-env';
import { injectTuiStartupInput } from './tui-startup-input';
import { prepareWindowsClaudeSettings } from './windows-claude-settings';

const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;

type RunStateWatcher = { stop(): void };

export class LocalConversationProvider implements ConversationProvider {
  private sessions = new Map<string, Pty>();
  private knownSessionIds = new Set<string>();
  private readonly pendingStarts = new Map<string, { token: symbol; completion: Promise<void> }>();
  private readonly projectId: string;
  readonly taskPath: string;
  private readonly taskId: string;
  private readonly tmux: boolean;
  private readonly shellSetup?: string;
  private readonly ctx: IExecutionContext;
  private readonly taskEnvVars: Record<string, string>;
  private readonly resolveProjectPromptPrinciples?: () => Promise<
    ProjectPromptPrinciples | undefined
  >;
  private readonly hookConfigWriter: HookConfigWriter;
  private readonly preparedHookProviders = new Map<string, boolean>();
  private readonly tmuxSessionNames = new Map<string, string>();
  private readonly sessionInfos = new Map<string, Omit<ActiveConversationSession, 'detachable'>>();
  private readonly runStateWatchers = new Map<string, RunStateWatcher[]>();
  private readonly sessionArtifactCleanups = new Map<string, { pty: Pty; cleanup: () => void }>();
  private readonly silenceReconcilerDetachers = new Map<string, () => void>();

  constructor({
    projectId,
    taskPath,
    taskId,
    tmux = false,
    shellSetup,
    ctx,
    taskEnvVars = {},
    resolveProjectPromptPrinciples,
  }: {
    projectId: string;
    taskPath: string;
    taskId: string;
    tmux?: boolean;
    shellSetup?: string;
    ctx: IExecutionContext;
    taskEnvVars?: Record<string, string>;
    resolveProjectPromptPrinciples?: () => Promise<ProjectPromptPrinciples | undefined>;
  }) {
    this.projectId = projectId;
    this.taskPath = taskPath;
    this.taskId = taskId;
    this.tmux = tmux;
    this.shellSetup = shellSetup;
    this.ctx = ctx;
    this.taskEnvVars = taskEnvVars;
    this.resolveProjectPromptPrinciples = resolveProjectPromptPrinciples;
    this.hookConfigWriter = new HookConfigWriter(new LocalFileSystem(taskPath), ctx);
  }

  async startSession(
    conversation: Conversation,
    initialSize: { cols: number; rows: number } = { cols: DEFAULT_COLS, rows: DEFAULT_ROWS },
    isResuming: boolean = false,
    initialPrompt?: string,
    tmuxOverride?: boolean,
    imagePaths?: string[],
    runtimeOverrides?: SessionRuntimeOverrides
  ): Promise<void> {
    const sessionId = makePtySessionId(
      conversation.projectId,
      conversation.taskId,
      conversation.id
    );
    this.knownSessionIds.add(sessionId);
    if (this.sessions.has(sessionId)) return;
    const existingStart = this.pendingStarts.get(sessionId);
    if (existingStart) return existingStart.completion;

    const startToken = Symbol(sessionId);
    let resolveCompletion!: () => void;
    let rejectCompletion!: (error: unknown) => void;
    const completion = new Promise<void>((resolve, reject) => {
      resolveCompletion = resolve;
      rejectCompletion = reject;
    });
    // The initiating caller receives errors through startSession itself. This
    // side promise exists so concurrent callers join the same attempt.
    void completion.catch(() => {});
    this.pendingStarts.set(sessionId, { token: startToken, completion });

    const registrationEpoch = ptySessionRegistry.beginRegistration(sessionId);
    let registrationAttempted = false;
    let registrationCompleted = false;
    let startCommitted = false;
    let startFailed = false;
    let spawnedPty: Pty | undefined;
    let invocationLogIdForRollback: string | undefined;
    let invocationLogFinished = false;
    let preparedSettingsCleanup: (() => void) | undefined;
    let artifactCleanupRegistered = false;
    let detachSilenceReconcilerForRollback: (() => void) | undefined;

    try {
      await claudeTrustService.maybeAutoTrustLocal({
        runtimeId: conversation.runtimeId,
        cwd: this.taskPath,
        homedir: homedir(),
      });
      if (!this.ownsPendingStart(sessionId, startToken)) return;
      await this.prepareHookConfig(
        conversation.runtimeId,
        makePtyId(conversation.runtimeId, conversation.id)
      );
      if (!this.ownsPendingStart(sessionId, startToken)) return;
      const hookOverrides = await hookOverridesStore.get(conversation.taskId);
      if (!this.ownsPendingStart(sessionId, startToken)) return;
      await applyHookOverrides(this.taskPath, conversation.runtimeId, hookOverrides);
      if (!this.ownsPendingStart(sessionId, startToken)) return;

      const providerConfig = await runtimeOverrideSettings.getItem(conversation.runtimeId);
      if (!this.ownsPendingStart(sessionId, startToken)) return;
      const runtimeStateRoot = conversation.sessionSource
        ? getConversationRuntimeStateRoot(conversation, providerConfig)
        : undefined;
      const sessionProviderConfig =
        runtimeStateRoot &&
        (conversation.runtimeId === 'codex' || conversation.runtimeId === 'claude')
          ? withRuntimeStateRoot(conversation.runtimeId, providerConfig, runtimeStateRoot)
          : providerConfig;
      if (conversation.runtimeId === 'codex') {
        await codexTrustService.maybeAutoTrustLocal({
          runtimeId: conversation.runtimeId,
          cwd: this.taskPath,
          codexHome: resolveRuntimeStateDirectory('codex', sessionProviderConfig),
        });
        if (!this.ownsPendingStart(sessionId, startToken)) return;
      }
      const titleStateRoot =
        conversation.runtimeId === 'codex' || conversation.runtimeId === 'claude'
          ? resolveRuntimeStateDirectory(conversation.runtimeId, sessionProviderConfig)
          : undefined;
      if (isResuming && conversation.runtimeId === 'codex' && runtimeStateRoot) {
        await import('@main/core/maas/maas-service').then(({ maasService }) =>
          maasService.reconcileCodexStateRoot(runtimeStateRoot)
        );
        if (!this.ownsPendingStart(sessionId, startToken)) return;
      }
      if (conversation.runtimeId === 'codex') {
        const migration = migrateLegacyCodexMaasHistoryForConfig(sessionProviderConfig);
        if (migration.failed) {
          log.warn('Could not migrate legacy Codex MaaS thread metadata; will retry next launch', {
            rows: migration.rows,
            files: migration.files,
          });
        }
      }
      const authProvider = providerConfig?.authProvider ?? 'official-subscription';
      const maasCredentials =
        authProvider === 'yoda-maas'
          ? await import('@main/core/maas/maas-service').then(({ maasService }) =>
              maasService.getRuntimeInferenceCredentials(
                conversation.runtimeId,
                providerConfig?.maasPlatformId
              )
            )
          : undefined;
      if (!this.ownsPendingStart(sessionId, startToken)) return;
      if (authProvider === 'yoda-maas' && !maasCredentials) {
        throw new Error(
          `MaaS is selected for ${conversation.runtimeId}, but no compatible connected platform is available.`
        );
      }
      const maasRuntimeEnv = maasCredentials
        ? resolveMaasRuntimeEnv(conversation.runtimeId, maasCredentials)
        : undefined;
      const maasEffective =
        maasCredentials !== undefined &&
        (conversation.runtimeId === 'codex' || maasRuntimeEnv !== undefined);
      interactiveTurnLogger.setSessionContext(conversation.id, {
        authProvider,
        maasEffective,
        ...(maasCredentials ? { maasPlatformId: maasCredentials.platformId } : {}),
      });
      recordConversationAuthProvider(conversation.id, providerConfig);
      if (conversation.skillPolicy?.warnings.length) {
        log.warn('Agent skill profile has runtime limitations', {
          conversationId: conversation.id,
          runtimeId: conversation.runtimeId,
          warnings: conversation.skillPolicy.warnings,
        });
      }
      const reservedThreadIds =
        isResuming && conversation.runtimeId === 'codex'
          ? await getReservedCodexThreadIds(conversation.id)
          : undefined;
      if (!this.ownsPendingStart(sessionId, startToken)) return;
      const codexThreadId =
        isResuming && conversation.runtimeId === 'codex'
          ? conversation.sessionSource
            ? resolveAgentResumeSessionId(conversation, this.taskPath, { reservedThreadIds })
            : resolveCodexThreadIdForConversation({
                conversationId: conversation.id,
                cwd: this.taskPath,
                title: conversation.title,
                createdAt: conversation.createdAt,
                lastInteractedAt: conversation.lastInteractedAt,
                statePath: resolveCodexStatePath(
                  resolveRuntimeStateDirectory('codex', sessionProviderConfig)
                ),
                reservedThreadIds,
              })
          : undefined;
      const effectiveIsResuming =
        isResuming && (conversation.runtimeId !== 'codex' || codexThreadId !== undefined);
      if (isResuming && conversation.runtimeId === 'codex' && !effectiveIsResuming) {
        log.warn('LocalConversationProvider: Codex thread is missing; starting a fresh session', {
          conversationId: conversation.id,
          cwd: this.taskPath,
        });
      }
      const agentSessionId = effectiveIsResuming
        ? (codexThreadId ??
          resolveAgentResumeSessionId(conversation, this.taskPath, { reservedThreadIds }))
        : conversation.id;
      if (effectiveIsResuming && conversation.runtimeId === 'codex') {
        const compatibility = ensureCodexResumeProviderCompatibleForConfig(
          agentSessionId,
          sessionProviderConfig
        );
        if (compatibility.status === 'repaired') {
          log.info('LocalConversationProvider: repaired stale Codex resume provider', {
            conversationId: conversation.id,
            threadId: agentSessionId,
            fromProviderId: compatibility.fromProviderId,
            toProviderId: compatibility.toProviderId,
          });
        } else if (compatibility.status === 'failed') {
          log.warn('LocalConversationProvider: could not repair stale Codex resume provider', {
            conversationId: conversation.id,
            threadId: agentSessionId,
            ...compatibility,
          });
        }
      }
      if (effectiveIsResuming) {
        await ensureCodexThreadUnarchived({
          runtimeId: conversation.runtimeId,
          providerConfig: sessionProviderConfig,
          threadId: agentSessionId,
          ctx: this.ctx,
          ...(runtimeStateRoot ? { statePath: resolveCodexStatePath(runtimeStateRoot) } : {}),
        });
        if (!this.ownsPendingStart(sessionId, startToken)) return;
      }
      const port = agentHookService.getPort();
      const token = agentHookService.getToken();
      const providerDef = getRuntime(conversation.runtimeId);
      const hooksAvailable = port > 0 && providerDef?.supportsHooks;
      const configuredStatusMonitor = resolveRuntimeStatusMonitor(
        conversation.runtimeId,
        sessionProviderConfig?.statusMonitor
      );
      // A selected hook monitor needs the local hook server. If it is down,
      // retain observability through the terminal classifier for this session.
      const statusMonitor: RuntimeStatusMonitorId =
        configuredStatusMonitor === 'hooks' && !hooksAvailable
          ? 'terminal'
          : configuredStatusMonitor;
      runtimeStatusMonitorRegistry.set(conversation.id, statusMonitor);
      // Image attachments: runtimes with clipboard paste get them injected as
      // native pastes after the TUI boots (so the prompt must NOT go through the
      // CLI arg, or the turn would start before the images land). Everyone else
      // gets @path mentions appended to the prompt.
      const pendingImagePaths = !effectiveIsResuming && imagePaths?.length ? imagePaths : undefined;
      const useClipboardImagePaste = Boolean(pendingImagePaths && providerDef?.clipboardImagePaste);
      const effectiveInitialPrompt =
        pendingImagePaths && !useClipboardImagePaste
          ? substituteImageMentions(initialPrompt, pendingImagePaths)
          : initialPrompt;
      const appendSystemPrompt = withExecutionModeInstructions(
        await getEnabledPromptPrinciplesText(
          await this.resolveProjectPromptPrinciples?.(),
          this.projectId
        ),
        conversation.executionMode
      );
      if (!this.ownsPendingStart(sessionId, startToken)) return;
      const terminalThemeMode = await resolveTerminalThemeMode();
      if (!this.ownsPendingStart(sessionId, startToken)) return;
      const effectiveRuntimeOverrides = mergeSessionRuntimeOverrides(
        conversation.runtimeOverrides,
        runtimeOverrides
      );
      const { permissionMode: runtimePermissionMode, ...runtimeCommandOverrides } =
        effectiveRuntimeOverrides ?? {};
      const baseCommand = buildAgentCommand({
        runtimeId: conversation.runtimeId,
        providerConfig: sessionProviderConfig,
        autoApprove: conversation.autoApprove,
        permissionMode: runtimePermissionMode ?? conversation.permissionMode,
        sessionId: agentSessionId,
        isResuming: effectiveIsResuming,
        initialPrompt:
          useClipboardImagePaste || conversation.runtimeId === 'cohub'
            ? undefined
            : effectiveInitialPrompt,
        workingDirectory: this.taskPath,
        appendSystemPrompt,
        ...runtimeCommandOverrides,
        terminalThemeMode,
        skillPolicy: conversation.skillPolicy,
        executionMode: conversation.executionMode,
      });
      const managedCommand =
        conversation.runtimeId === 'cohub'
          ? buildCohubAdapterCommand({
              cohubCommand: baseCommand,
              conversationId: conversation.id,
              cwd: this.taskPath,
              initialPrompt: effectiveIsResuming ? undefined : effectiveInitialPrompt,
            })
          : baseCommand;
      const { command, args: baseArgs, startupInput } = managedCommand;
      const argsWithNotify = withCodexRuntimeNotifyArgs(conversation.runtimeId, baseArgs, port);

      const tmuxSessionName = await this.resolveTmuxSessionName(sessionId, tmuxOverride);
      if (!this.ownsPendingStart(sessionId, startToken)) return;
      const configuredRuntimeEnv = resolveRuntimeEnv(sessionProviderConfig, {
        runtimeId: conversation.runtimeId,
        tmuxEnabled: Boolean(tmuxSessionName),
      });
      const managedRuntimeEnv =
        conversation.runtimeId === 'cohub' ? getCohubAdapterEnvironment() : undefined;
      const providerEnv =
        configuredRuntimeEnv || maasRuntimeEnv || managedRuntimeEnv
          ? { ...configuredRuntimeEnv, ...maasRuntimeEnv, ...managedRuntimeEnv }
          : undefined;

      const preparedSettings = prepareWindowsClaudeSettings(conversation.runtimeId, argsWithNotify);
      preparedSettingsCleanup = preparedSettings.cleanup;
      const args = preparedSettings.args;
      const ptyId = makePtyId(conversation.runtimeId, conversation.id);

      // Log the logical agent command, not the resolved PTY spawn (the tmux
      // wrapper around it is launch plumbing, useless for debugging the run).
      // The initial prompt arg is dropped — it's recorded in the prompt field.
      let invocationLogId: string;
      try {
        invocationLogId = await aiLogService.start({
          purpose: 'interactive-session',
          mode: 'interactive',
          runtime: conversation.runtimeId,
          command:
            conversation.runtimeId === 'cohub'
              ? [baseCommand.command, ...baseCommand.args].join(' ')
              : [command, ...args.filter((arg) => arg !== effectiveInitialPrompt)].join(' '),
          prompt: effectiveInitialPrompt ?? null,
          metadata: {
            projectId: conversation.projectId,
            taskId: conversation.taskId,
            conversationId: conversation.id,
            resuming: String(effectiveIsResuming),
            authProvider,
            maasEffective: String(maasEffective),
            ...(maasCredentials ? { maasPlatformId: maasCredentials.platformId } : {}),
          },
        });
        invocationLogIdForRollback = invocationLogId;
      } catch (error) {
        preparedSettings.cleanup?.();
        preparedSettingsCleanup = undefined;
        throw error;
      }
      if (!this.ownsPendingStart(sessionId, startToken)) return;

      const sessionStartedAtMs = Date.now();
      const pty = (() => {
        try {
          const resolved = resolveLocalPtySpawn({
            platform: process.platform,
            env: process.env,
            intent: {
              kind: 'run-command',
              cwd: this.taskPath,
              command: { kind: 'argv', command, args },
              shellSetup: this.shellSetup,
              tmuxSessionName,
              tmuxSize: initialSize,
              tmuxEnv:
                conversation.runtimeId === 'cohub'
                  ? providerEnv
                  : resolveRuntimeTmuxEnv(providerEnv),
              tmuxSessionIdentity: agentSessionId,
              tmuxSessionIdentityAliases:
                conversation.runtimeId === 'codex' && !conversation.sessionSource
                  ? [conversation.id]
                  : undefined,
            },
          });

          logLocalPtySpawnWarnings('LocalConversationProvider', resolved.warnings, {
            conversationId: conversation.id,
            sessionId,
          });

          return spawnLocalPty({
            id: sessionId,
            command: resolved.command,
            args: resolved.args,
            cwd: resolved.cwd,
            env: {
              ...buildAgentEnv({
                agentApiVars: resolveAgentApiEnvVars(sessionProviderConfig, conversation.runtimeId),
                hook: port > 0 ? { port, ptyId, token } : undefined,
                providerVars: providerEnv,
              }),
              ...this.taskEnvVars,
            },
            cols: initialSize.cols,
            rows: initialSize.rows,
          });
        } catch (error) {
          preparedSettings.cleanup?.();
          preparedSettingsCleanup = undefined;
          void aiLogService.finish(invocationLogId, {
            status: 'failed',
            error: `PTY spawn failed: ${String(error)}`,
          });
          invocationLogFinished = true;
          throw error;
        }
      })();
      spawnedPty = pty;
      const startupInputPromise = startupInput
        ? injectTuiStartupInput({ pty, runtimeId: conversation.runtimeId, input: startupInput })
        : undefined;
      // Attach the readiness listener immediately so early TUI output is observed;
      // the result is awaited after registry ownership is committed below.
      void startupInputPromise?.catch(() => {});

      if (preparedSettings.cleanup) {
        this.sessionArtifactCleanups.set(sessionId, {
          pty,
          cleanup: preparedSettings.cleanup,
        });
        artifactCleanupRegistered = true;
        pty.onExit(() => this.cleanupSessionArtifacts(sessionId, pty));
      }

      const hasAuthoritativeRunState = statusMonitor !== 'terminal';

      // Codex's rollout is authoritative for turn boundaries, but its
      // command-approval prompt is rendered only in the PTY and is absent
      // from the rollout until the user answers. Keep the narrow Codex
      // classifier attached as a supplementary attention signal.
      if (statusMonitor === 'terminal' || conversation.runtimeId === 'codex') {
        wireAgentClassifier({
          pty,
          runtimeId: conversation.runtimeId,
          projectId: conversation.projectId,
          taskId: conversation.taskId,
          conversationId: conversation.id,
        });
      }

      const detachSilenceReconciler = agentSilenceReconciler.attach(
        sessionId,
        {
          projectId: conversation.projectId,
          taskId: conversation.taskId,
          conversationId: conversation.id,
        },
        {
          // Claude session activity and Codex rollout tailers are
          // authoritative. Their turns may legitimately produce no PTY output
          // during a long-running tool call, so silence must not clear `working`.
          // Keep the shared tracker lifecycle attached for diagnostics and
          // deterministic cleanup, without letting silence change run state.
          autoReconcile: !hasAuthoritativeRunState,
        }
      );
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
          })
        );
      }

      let shouldEmitAgentSessionExited = false;
      pty.onExit(({ exitCode }) => {
        this.releaseSilenceReconciler(sessionId, detachSilenceReconciler);
        if (this.sessions.get(sessionId) !== pty) return;
        shouldEmitAgentSessionExited = true;
        void aiLogService.finish(invocationLogId, {
          status: typeof exitCode === 'number' && exitCode !== 0 ? 'failed' : 'succeeded',
          error:
            typeof exitCode === 'number' && exitCode !== 0 ? `Exit code ${exitCode}` : undefined,
        });
        void interactiveTurnLogger.onSessionExit(conversation.id);
        this.sessions.delete(sessionId);
        this.sessionInfos.delete(sessionId);
        this.stopRunStateWatcher(conversation.id);
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
      });

      if (!this.ownsPendingStart(sessionId, startToken)) return;
      registrationAttempted = true;
      ptySessionRegistry.register(sessionId, pty, {
        onFinalExit: (info) => {
          if (!shouldEmitAgentSessionExited) return;
          events.emit(agentSessionExitedChannel, {
            sessionId,
            projectId: conversation.projectId,
            conversationId: conversation.id,
            taskId: conversation.taskId,
            exitCode: info.exitCode,
          });
          snapshotTaskDiffOnSessionExit(conversation.taskId);
        },
        registrationEpoch,
        tmuxBacked: Boolean(tmuxSessionName),
      });
      registrationCompleted = true;
      if (!this.ownsPendingStart(sessionId, startToken)) {
        ptySessionRegistry.unregister(sessionId);
        return;
      }
      this.sessions.set(sessionId, pty);
      this.sessionInfos.set(sessionId, {
        sessionId,
        conversationId: conversation.id,
        projectId: conversation.projectId,
        taskId: conversation.taskId,
        ...(pty.pid === undefined ? {} : { pid: pty.pid }),
        runtimeId: conversation.runtimeId,
        title: conversation.title,
      });
      agentSessionRuntimeStore.setStatus(
        {
          projectId: conversation.projectId,
          taskId: conversation.taskId,
          conversationId: conversation.id,
        },
        initialPrompt?.trim() || pendingImagePaths ? 'working' : 'idle'
      );
      if (startupInputPromise) {
        const delivered = await startupInputPromise;
        if (!this.ownsPendingStart(sessionId, startToken)) return;
        if (!delivered) throw new Error(`${conversation.runtimeId} exited before startup input.`);
      }
      if (useClipboardImagePaste && pendingImagePaths) {
        void injectClipboardImagesAndPrompt({
          pty,
          runtimeId: conversation.runtimeId,
          imagePaths: pendingImagePaths,
          prompt: initialPrompt,
        }).catch((error) => {
          log.warn('LocalConversationProvider: clipboard image injection failed', {
            conversationId: conversation.id,
            error: String(error),
          });
        });
      }
      if (tmuxSessionName) this.tmuxSessionNames.set(sessionId, tmuxSessionName);
      sessionTitleManager.start({
        runtimeId: conversation.runtimeId,
        conversationId: conversation.id,
        projectId: conversation.projectId,
        taskId: conversation.taskId,
        cwd: this.taskPath,
        startedAtMs: sessionStartedAtMs,
        isResuming: effectiveIsResuming,
        agentSessionId: effectiveIsResuming ? agentSessionId : undefined,
        stateRoot: titleStateRoot,
      });
      this.startRunStateWatcher(
        conversation,
        sessionStartedAtMs,
        effectiveIsResuming,
        agentSessionId,
        runtimeStateRoot,
        statusMonitor
      );
      telemetryService.capture('agent_run_started', {
        provider: conversation.runtimeId,
        project_id: conversation.projectId,
        task_id: conversation.taskId,
        conversation_id: conversation.id,
      });
      startCommitted = true;
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
        if (artifactCleanupRegistered) {
          this.cleanupSessionArtifacts(sessionId, spawnedPty);
        } else {
          preparedSettingsCleanup?.();
        }
        try {
          spawnedPty.kill();
        } catch {}
        if (ownsStart && registrationAttempted) {
          ptySessionRegistry.unregister(sessionId);
        }
        if (invocationLogIdForRollback && !invocationLogFinished) {
          void aiLogService.finish(invocationLogIdForRollback, {
            status: 'failed',
            error: startFailed ? 'PTY startup failed' : 'PTY startup cancelled',
          });
        }
      } else if (!startCommitted) {
        preparedSettingsCleanup?.();
        if (invocationLogIdForRollback && !invocationLogFinished) {
          void aiLogService.finish(invocationLogIdForRollback, {
            status: 'failed',
            error: startFailed ? 'PTY startup failed' : 'PTY startup cancelled',
          });
        }
      }
      if (!registrationCompleted) {
        ptySessionRegistry.cancelRegistration(sessionId, registrationEpoch);
      }
      if (!startCommitted) runtimeStatusMonitorRegistry.remove(conversation.id);
      if (ownsStart) this.pendingStarts.delete(sessionId);
      if (!startFailed) resolveCompletion();
    }
  }

  /**
   * Attach the run-state source selected for this client. Native choices tail
   * the CLI's own state; hooks and terminal classification are wired earlier in
   * startup and therefore need no watcher here.
   */
  private startRunStateWatcher(
    conversation: Conversation,
    startedAtMs: number,
    isResuming: boolean,
    agentSessionId: string,
    stateRoot: string | undefined,
    statusMonitor: RuntimeStatusMonitorId
  ): void {
    this.stopRunStateWatcher(conversation.id);
    runtimeStatusMonitorRegistry.set(conversation.id, statusMonitor);
    const session = {
      projectId: conversation.projectId,
      taskId: conversation.taskId,
      conversationId: conversation.id,
    };
    if (conversation.runtimeId === 'codex' && statusMonitor === 'rollout') {
      const watcher = watchCodexRunState(
        {
          conversationId: conversation.id,
          cwd: this.taskPath,
          startedAtMs,
          isResuming,
          threadId: agentSessionId,
        },
        (event) => agentSessionRuntimeStore.dispatch(session, event, 'codex-rollout'),
        stateRoot ? { statePath: resolveCodexStatePath(stateRoot) } : undefined
      );
      this.runStateWatchers.set(conversation.id, [watcher]);
      return;
    }
    if (conversation.runtimeId === 'claude' && statusMonitor === 'transcript') {
      const watcher = watchClaudeRunState(
        { conversationId: conversation.id, cwd: this.taskPath },
        (event) => agentSessionRuntimeStore.dispatch(session, event, 'claude-transcript'),
        () => agentSessionRuntimeStore.getStatus(session),
        {
          sessionId: agentSessionId,
          claudeConfigDir: stateRoot,
        }
      );
      this.runStateWatchers.set(conversation.id, [watcher]);
      return;
    }
    if (conversation.runtimeId === 'claude' && statusMonitor === 'activity') {
      const processPid = this.getSessionProcessPid(conversation.id);
      const activityContext =
        processPid === undefined
          ? { conversationId: conversation.id, cwd: this.taskPath }
          : { conversationId: conversation.id, cwd: this.taskPath, processPid };
      this.runStateWatchers.set(conversation.id, [
        watchClaudeSessionActivity({ ...activityContext, claudeHomeDir: stateRoot }, (event) =>
          agentSessionRuntimeStore.dispatch(session, event, 'claude-session-activity')
        ),
      ]);
    }
  }

  private getSessionProcessPid(conversationId: string): number | undefined {
    const sessionId = makePtySessionId(this.projectId, this.taskId, conversationId);
    return this.sessions.get(sessionId)?.pid;
  }

  private stopRunStateWatcher(conversationId: string): void {
    runtimeStatusMonitorRegistry.remove(conversationId);
    const watchers = this.runStateWatchers.get(conversationId);
    if (!watchers) return;
    for (const watcher of watchers) {
      try {
        watcher.stop();
      } catch {}
    }
    this.runStateWatchers.delete(conversationId);
  }

  private resolveTmuxSessionName(
    sessionId: string,
    tmuxOverride?: boolean
  ): Promise<string | undefined> {
    return resolveAvailableTmuxSessionName({
      auto: false,
      ctx: this.ctx,
      requested: tmuxOverride ?? this.tmux,
      sessionId,
      source: 'LocalConversationProvider',
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
    return Array.from(this.sessions.keys()).flatMap((sessionId) => {
      const info = this.sessionInfos.get(sessionId);
      if (!info) return [];
      return [{ ...info, detachable: this.tmuxSessionNames.has(sessionId) }];
    });
  }

  async sendInput(conversationId: string, data: string): Promise<boolean> {
    const sessionId = makePtySessionId(this.projectId, this.taskId, conversationId);
    const pty = this.sessions.get(sessionId);
    if (pty) {
      pty.write(data);
      return true;
    }

    const tmuxSessionName = this.tmuxSessionNames.get(sessionId);
    if (!tmuxSessionName) return false;

    await sendLiteralToTmuxSession(this.ctx, tmuxSessionName, data);
    return true;
  }

  private async prepareHookConfig(
    runtimeId: Conversation['runtimeId'],
    ptyId: string
  ): Promise<void> {
    try {
      const localProjectSettings = await appSettingsService.get('localProject');
      const writeGitIgnoreEntries = localProjectSettings.writeAgentConfigToGitIgnore ?? true;
      const previousWriteGitIgnoreEntries = this.preparedHookProviders.get(runtimeId);
      const shouldPrepareHookConfig =
        previousWriteGitIgnoreEntries === undefined ||
        (!previousWriteGitIgnoreEntries && writeGitIgnoreEntries);
      if (!shouldPrepareHookConfig) return;

      await this.hookConfigWriter.writeForProvider(runtimeId, {
        writeGitIgnoreEntries,
        ptyId,
      });
      this.preparedHookProviders.set(runtimeId, writeGitIgnoreEntries);
    } catch (error) {
      log.warn('LocalConversationProvider: failed to prepare hook config', {
        runtimeId,
        taskPath: this.taskPath,
        error: String(error),
      });
    }
  }

  private cleanupSessionArtifacts(sessionId: string, expectedPty?: Pty): void {
    const entry = this.sessionArtifactCleanups.get(sessionId);
    if (!entry || (expectedPty && entry.pty !== expectedPty)) return;
    this.sessionArtifactCleanups.delete(sessionId);
    try {
      entry.cleanup();
    } catch (error) {
      log.warn('LocalConversation: failed to clean session artifacts', {
        sessionId,
        error: String(error),
      });
    }
  }

  private ownsPendingStart(sessionId: string, token: symbol): boolean {
    return this.pendingStarts.get(sessionId)?.token === token;
  }

  private cancelPendingStart(sessionId: string): void {
    this.pendingStarts.delete(sessionId);
  }

  private cancelAllPendingStarts(): void {
    for (const sessionId of this.pendingStarts.keys()) {
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
    this.knownSessionIds.delete(sessionId);
    this.cancelPendingStart(sessionId);
    this.releaseSilenceReconciler(sessionId);
    sessionTitleManager.stop(conversationId);
    this.stopRunStateWatcher(conversationId);
    const pty = this.sessions.get(sessionId);
    if (pty) {
      try {
        pty.kill();
      } catch (e) {
        log.warn('LocalConversation: error killing PTY', { sessionId, error: String(e) });
      }
      this.sessions.delete(sessionId);
    }
    // Also cancels a registration/input epoch when stop races startup before
    // the provider has inserted a PTY into this.sessions.
    ptySessionRegistry.unregister(sessionId);
    this.cleanupSessionArtifacts(sessionId, pty);
    this.sessionInfos.delete(sessionId);
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
    this.sessionInfos.clear();
  }

  async detachAll(): Promise<void> {
    this.cancelAllPendingStarts();
    for (const sessionId of Array.from(this.silenceReconcilerDetachers.keys())) {
      this.releaseSilenceReconciler(sessionId);
    }
    for (const [sessionId, pty] of this.sessions) {
      const conversationId = sessionId.split(':').pop();
      if (conversationId) {
        sessionTitleManager.stop(conversationId);
        this.stopRunStateWatcher(conversationId);
      }
      try {
        pty.kill();
      } catch {}
      this.cleanupSessionArtifacts(sessionId, pty);
      ptySessionRegistry.unregister(sessionId);
    }
    for (const sessionId of this.sessionArtifactCleanups.keys()) {
      this.cleanupSessionArtifacts(sessionId);
    }
    for (const info of this.sessionInfos.values()) {
      agentSessionRuntimeStore.remove(info);
    }
    this.sessions.clear();
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

function withCodexRuntimeNotifyArgs(
  runtimeId: Conversation['runtimeId'],
  args: string[],
  hookPort: number
): string[] {
  if (runtimeId !== 'codex' || hookPort <= 0) return args;
  return ['-c', `notify=${tomlArray(makeCodexNotifyCommand())}`, ...args];
}

function tomlArray(values: string[]): string {
  return `[${values.map((value) => JSON.stringify(value)).join(',')}]`;
}
