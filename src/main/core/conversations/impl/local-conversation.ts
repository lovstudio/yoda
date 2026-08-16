import { homedir } from 'node:os';
import {
  mergeSessionRuntimeOverrides,
  type Conversation,
  type SessionRuntimeOverrides,
} from '@shared/conversations';
import { agentSessionExitedChannel } from '@shared/events/agentEvents';
import type { ProjectPromptPrinciples } from '@shared/project-settings';
import { makePtyId } from '@shared/ptyId';
import { makePtySessionId, parsePtySessionId } from '@shared/ptySessionId';
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
import { describeInvocationEndpoint } from '@main/core/ai-logs/invocation-endpoint';
import { agentSessionRuntimeStore } from '@main/core/conversations/agent-session-runtime';
import { agentSilenceReconciler } from '@main/core/conversations/agent-silence-reconciler';
import { createClaudeInterruptSniffer } from '@main/core/conversations/claude-interrupt-sniffer';
import { watchClaudeRunState } from '@main/core/conversations/claude-run-state-source';
import { watchClaudeSessionActivity } from '@main/core/conversations/claude-session-activity-source';
import {
  repairCodexDuplicatedSessionMetaBoundary,
  repairCodexThreadHistoryProjection,
} from '@main/core/conversations/codex-history-projection-repair';
import { watchCodexRunState } from '@main/core/conversations/codex-run-state-source';
import { runtimeStatusMonitorRegistry } from '@main/core/conversations/runtime-status-monitor-registry';
import type {
  ActiveConversationSession,
  ConversationProvider,
  ConversationStartOptions,
} from '@main/core/conversations/types';
import type { IExecutionContext } from '@main/core/execution-context/types';
import { LocalFileSystem } from '@main/core/fs/impl/local-fs';
import {
  ensureCodexResumeProviderCompatibleForConfig,
  migrateLegacyCodexMaasHistoryForConfig,
} from '@main/core/maas/codex-history-compat';
import { ensureCodexMaasCompatibleModelCatalog } from '@main/core/maas/codex-maas-model-catalog';
import { CODEX_SHARED_PROVIDER_ID } from '@main/core/maas/codex-maas-provider';
import {
  resolveCodexMaasRuntimeArgs,
  resolveCodexOfficialRuntimeArgs,
  resolveMaasRuntimeEnv,
  rewriteCodexMaasModelArgs,
} from '@main/core/maas/runtime-env';
import { captureAgentExitTail, describeAgentExit } from '@main/core/pty/agent-exit-diagnostics';
import { spawnLocalPty } from '@main/core/pty/local-pty';
import type { Pty } from '@main/core/pty/pty';
import { buildAgentEnv } from '@main/core/pty/pty-env';
import { ptySessionRegistry } from '@main/core/pty/pty-session-registry';
import { logLocalPtySpawnWarnings, resolveLocalPtySpawn } from '@main/core/pty/pty-spawn-platform';
import { resolveAvailableTmuxSessionName } from '@main/core/pty/tmux-availability';
import { TmuxReattachMissError, waitForTmuxReattach } from '@main/core/pty/tmux-reattach';
import {
  killTmuxSession,
  listTmuxSessionMarkersStrict,
  sendLiteralToTmuxSession,
  type TmuxSessionMarker,
} from '@main/core/pty/tmux-session-name';
import {
  findAcknowledgedCodexThreadForInitialPrompt,
  resolveCodexStatePath,
} from '@main/core/session-title/codex-title-source';
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
import {
  cancelConversationHydrationBarrier,
  cancelConversationHydrationBarriersForTask,
} from '../conversation-hydration-barrier';
import { getConversationRuntimeStateRoot } from '../conversation-session-source';
import { withExecutionModeInstructions } from '../execution-mode';
import { createLocalAgentSessionCatalogId } from '../local-agent-session-catalog';
import { recordPendingInitialPromptAttempt } from '../pending-initial-prompt-store';
import { withRuntimeStateRoot } from '../session-state-roots';
import {
  recordConversationAuthProvider,
  snapshotConversationUsageOnSessionExit,
  snapshotTaskDiffOnSessionExit,
} from '../session-stats-hooks';
import { storeConversationSessionSource } from '../stored-conversation-session-source';
import { buildAgentCommand } from './agent-command';
import { injectClipboardImagesAndPrompt, substituteImageMentions } from './image-attachments';
import { getEnabledPromptPrinciplesText } from './prompt-principles';
import { classifyLostPtyTransport, type PtyExitClassification } from './pty-exit-classification';
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
  private readonly intentionallyDetachedPtys = new WeakSet<Pty>();
  private readonly pendingStarts = new Map<string, { token: symbol; completion: Promise<void> }>();
  private readonly projectId: string;
  private readonly sidebarWorkspaceId?: string | null;
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
  private readonly transportDetachedAt = new Map<string, number>();
  private readonly inputTails = new Map<string, Promise<void>>();
  private readonly sessionInfos = new Map<string, Omit<ActiveConversationSession, 'detachable'>>();
  private readonly runStateWatchers = new Map<string, RunStateWatcher[]>();
  private readonly sessionArtifactCleanups = new Map<string, { pty: Pty; cleanup: () => void }>();
  private readonly silenceReconcilerDetachers = new Map<string, () => void>();

  waitsForInitialPromptSessionBinding(runtimeId: Conversation['runtimeId']): boolean {
    return runtimeId === 'codex';
  }

  constructor({
    projectId,
    sidebarWorkspaceId,
    taskPath,
    taskId,
    tmux = false,
    shellSetup,
    ctx,
    taskEnvVars = {},
    resolveProjectPromptPrinciples,
  }: {
    projectId: string;
    sidebarWorkspaceId?: string | null;
    taskPath: string;
    taskId: string;
    tmux?: boolean;
    shellSetup?: string;
    ctx: IExecutionContext;
    taskEnvVars?: Record<string, string>;
    resolveProjectPromptPrinciples?: () => Promise<ProjectPromptPrinciples | undefined>;
  }) {
    this.projectId = projectId;
    this.sidebarWorkspaceId = sidebarWorkspaceId;
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
    runtimeOverrides?: SessionRuntimeOverrides,
    startOptions?: ConversationStartOptions
  ): Promise<void> {
    const sessionId = makePtySessionId(
      conversation.projectId,
      conversation.taskId,
      conversation.id
    );
    let reattachExistingTmuxSession = startOptions?.reattachExistingTmuxSession === true;
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
    let reattachMarkerBaseline: TmuxSessionMarker | undefined;

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
      const providerDef = getRuntime(conversation.runtimeId);
      const pendingAttempt = conversation.pendingInitialPrompt;
      if (
        conversation.runtimeId === 'codex' &&
        !isResuming &&
        !reattachExistingTmuxSession &&
        pendingAttempt?.attemptStartedAtMs !== undefined
      ) {
        const pendingExpectedPrompt = pendingAttempt.imagePaths?.length
          ? substituteImageMentions(pendingAttempt.prompt, pendingAttempt.imagePaths)
          : pendingAttempt.prompt;
        if (pendingExpectedPrompt?.trim()) {
          const pendingStateRoot =
            pendingAttempt.attemptStateRoot ??
            resolveRuntimeStateDirectory('codex', providerConfig);
          const acknowledgedThread = findAcknowledgedCodexThreadForInitialPrompt({
            statePath: resolveCodexStatePath(pendingStateRoot),
            cwd: pendingAttempt.attemptCwd ?? this.taskPath,
            attemptStartedAtMs: pendingAttempt.attemptStartedAtMs,
            expectedInitialPrompt: pendingExpectedPrompt,
          });
          if (acknowledgedThread) {
            const sessionSource = {
              catalogId: createLocalAgentSessionCatalogId(
                'codex',
                pendingStateRoot,
                acknowledgedThread.id
              ),
              runtimeId: 'codex' as const,
              sessionId: acknowledgedThread.id,
              stateRoot: pendingStateRoot,
            };
            const stored = await storeConversationSessionSource(conversation.id, sessionSource, {
              projectId: conversation.projectId,
              taskId: conversation.taskId,
              expectedPendingAttemptStartedAtMs: pendingAttempt.attemptStartedAtMs,
            });
            if (!this.ownsPendingStart(sessionId, startToken)) return;
            if (stored) {
              conversation = {
                ...conversation,
                sessionSource,
                pendingInitialPrompt: undefined,
              };
              isResuming = true;
              initialPrompt = undefined;
              imagePaths = undefined;
            }
          }
        }
      }
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
      if (
        isResuming &&
        conversation.runtimeId === 'codex' &&
        runtimeStateRoot &&
        !reattachExistingTmuxSession
      ) {
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
      let restartTmuxAfterHistoryRepair = false;
      if (
        effectiveIsResuming &&
        conversation.runtimeId === 'codex' &&
        !reattachExistingTmuxSession
      ) {
        const compatibility = ensureCodexResumeProviderCompatibleForConfig(
          agentSessionId,
          sessionProviderConfig,
          CODEX_SHARED_PROVIDER_ID
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

        const statePath = resolveCodexStatePath(
          resolveRuntimeStateDirectory('codex', sessionProviderConfig)
        );
        const duplicateBoundaryRepair = repairCodexDuplicatedSessionMetaBoundary({
          statePath,
          threadId: agentSessionId,
        });
        if (duplicateBoundaryRepair.status === 'repaired') {
          log.info('LocalConversationProvider: restored portable Codex resume history', {
            conversationId: conversation.id,
            threadId: agentSessionId,
            ...duplicateBoundaryRepair,
          });
        } else if (duplicateBoundaryRepair.status === 'failed') {
          log.warn('LocalConversationProvider: could not restore portable Codex resume history', {
            conversationId: conversation.id,
            threadId: agentSessionId,
            reason: duplicateBoundaryRepair.reason,
          });
        }

        const projectionRepair = repairCodexThreadHistoryProjection({
          statePath,
          threadId: agentSessionId,
        });
        if (projectionRepair.status === 'repaired') {
          restartTmuxAfterHistoryRepair = true;
          log.info('LocalConversationProvider: repaired stalled Codex history projection', {
            conversationId: conversation.id,
            threadId: agentSessionId,
            ...projectionRepair,
          });
        } else if (projectionRepair.status === 'failed') {
          log.warn('LocalConversationProvider: could not repair Codex history projection', {
            conversationId: conversation.id,
            threadId: agentSessionId,
            reason: projectionRepair.reason,
          });
        }
      }
      if (effectiveIsResuming && !reattachExistingTmuxSession) {
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
        await getEnabledPromptPrinciplesText(await this.resolveProjectPromptPrinciples?.(), {
          projectId: this.projectId,
          workspaceId: this.sidebarWorkspaceId,
        }),
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
      const codexMaasModelCatalogPath =
        conversation.runtimeId === 'codex' && maasCredentials
          ? await ensureCodexMaasCompatibleModelCatalog(
              resolveRuntimeStateDirectory('codex', sessionProviderConfig)
            )
          : undefined;
      if (!this.ownsPendingStart(sessionId, startToken)) return;
      const argsWithProvider =
        conversation.runtimeId !== 'codex'
          ? baseArgs
          : maasCredentials
            ? [
                ...rewriteCodexMaasModelArgs(baseArgs, maasCredentials),
                ...resolveCodexMaasRuntimeArgs(maasCredentials, codexMaasModelCatalogPath),
              ]
            : [...baseArgs, ...resolveCodexOfficialRuntimeArgs()];
      const argsWithNotify = withCodexRuntimeNotifyArgs(
        conversation.runtimeId,
        argsWithProvider,
        port
      );

      const retainedTmuxSessionName = reattachExistingTmuxSession
        ? this.tmuxSessionNames.get(sessionId)
        : undefined;
      const tmuxSessionName =
        retainedTmuxSessionName ?? (await this.resolveTmuxSessionName(sessionId, tmuxOverride));
      if (!this.ownsPendingStart(sessionId, startToken)) return;
      if (reattachExistingTmuxSession && !tmuxSessionName) {
        throw new TmuxReattachMissError();
      }
      if (tmuxSessionName && (reattachExistingTmuxSession || pendingAttempt?.attemptStartedAtMs)) {
        const markers = performanceTrace
          ? await performanceTrace.measure(
              'tmux-marker-probe',
              () => listTmuxSessionMarkersStrict(this.ctx),
              (result) => ({
                markerCount: result.length,
                reattachExisting: reattachExistingTmuxSession,
                transport: 'local',
              })
            )
          : await listTmuxSessionMarkersStrict(this.ctx);
        if (!this.ownsPendingStart(sessionId, startToken)) return;
        const canonicalPane = markers.find((marker) => marker.sessionName === tmuxSessionName);
        if (reattachExistingTmuxSession && !canonicalPane) {
          throw new TmuxReattachMissError();
        }
        if (
          !reattachExistingTmuxSession &&
          !effectiveIsResuming &&
          pendingAttempt?.attemptStartedAtMs !== undefined &&
          canonicalPane
        ) {
          reattachExistingTmuxSession = true;
        }
        if (reattachExistingTmuxSession) reattachMarkerBaseline = canonicalPane;
      }
      // A surviving Codex process already reconstructed the truncated prefix in
      // memory. Replace only this Yoda-owned tmux session after a successful
      // cursor repair so the next process reloads the now-complete projection.
      if (restartTmuxAfterHistoryRepair && tmuxSessionName) {
        await killTmuxSession(this.ctx, tmuxSessionName);
        if (!this.ownsPendingStart(sessionId, startToken)) return;
      }
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
      const invocationEndpoint = describeInvocationEndpoint(providerEnv);
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
            ...(invocationEndpoint ? { endpoint: invocationEndpoint } : {}),
          },
        });
        invocationLogIdForRollback = invocationLogId;
        interactiveTurnLogger.attachSessionLog(conversation.id, invocationLogId);
      } catch (error) {
        preparedSettings.cleanup?.();
        preparedSettingsCleanup = undefined;
        throw error;
      }
      if (!this.ownsPendingStart(sessionId, startToken)) return;

      const sessionStartedAtMs = Date.now();
      let titleDiscoveryStartedAtMs = sessionStartedAtMs;
      let titleDiscoveryStateRoot = titleStateRoot;
      if (
        conversation.runtimeId === 'codex' &&
        !effectiveIsResuming &&
        conversation.pendingInitialPrompt
      ) {
        const previousAttemptStartedAtMs = conversation.pendingInitialPrompt.attemptStartedAtMs;
        if (reattachExistingTmuxSession && previousAttemptStartedAtMs !== undefined) {
          titleDiscoveryStartedAtMs = previousAttemptStartedAtMs;
          titleDiscoveryStateRoot =
            conversation.pendingInitialPrompt.attemptStateRoot ?? titleStateRoot;
        } else {
          titleDiscoveryStartedAtMs = Date.now();
          const recordedPending = await recordPendingInitialPromptAttempt(
            conversation.id,
            titleDiscoveryStartedAtMs,
            {
              projectId: conversation.projectId,
              taskId: conversation.taskId,
              stateRoot: titleStateRoot,
              cwd: this.taskPath,
            },
            conversation.pendingInitialPrompt.deliveryToken
          );
          if (!this.ownsPendingStart(sessionId, startToken)) return;
          if (!recordedPending) {
            log.info('LocalConversationProvider: pending prompt was acknowledged concurrently', {
              conversationId: conversation.id,
            });
            return;
          }
        }
      }
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
          transport: 'local',
        });
      }
      const spawnPty = () => {
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
              tmuxReattachExistingSession: reattachExistingTmuxSession,
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
      };
      const pty = performanceTrace
        ? performanceTrace.measureSync('provider-spawn', spawnPty, {
            runtimeId: conversation.runtimeId,
            tmuxEnabled: Boolean(tmuxSessionName),
            reattachExisting: reattachExistingTmuxSession,
            transport: 'local',
          })
        : spawnPty();
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
          transport: 'local',
        });
      });
      const tmuxReattachPromise = reattachMarkerBaseline
        ? waitForTmuxReattach({ ctx: this.ctx, pty, baseline: reattachMarkerBaseline })
        : undefined;
      const startupInputPromise =
        startupInput && !reattachExistingTmuxSession
          ? injectTuiStartupInput({ pty, runtimeId: conversation.runtimeId, input: startupInput })
          : undefined;
      const clipboardInputPromise =
        useClipboardImagePaste && pendingImagePaths && !reattachExistingTmuxSession
          ? injectClipboardImagesAndPrompt({
              pty,
              runtimeId: conversation.runtimeId,
              imagePaths: pendingImagePaths,
              prompt: initialPrompt,
            })
          : undefined;
      // Attach the readiness listener immediately so early TUI output is observed;
      // the result is awaited after registry ownership is committed below.
      void startupInputPromise?.catch(() => {});
      void clipboardInputPromise?.catch(() => {});
      void tmuxReattachPromise?.catch(() => {});

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
            ptySessionId: sessionId,
          })
        );
      }

      // A dead PTY only proves the transport died. For a tmux-backed session the
      // Agent runs inside the tmux pane and outlives every client, so an
      // unexpected wrapper death (flow-control kill, client crash, SIGHUP) must
      // not be reported as an Agent exit: that clears `working` and surfaces
      // "session stopped" while the provider CLI is still mid-turn. tmux is the
      // only authority, and probing it is asynchronous — hence a promise the
      // final-exit emitter awaits instead of a synchronous flag.
      let exitClassification: Promise<PtyExitClassification> | null = null;
      pty.onExit(({ exitCode, signal }) => {
        if (this.intentionallyDetachedPtys.delete(pty)) {
          this.releaseSilenceReconciler(sessionId, detachSilenceReconciler);
          if (!invocationLogFinished) {
            invocationLogFinished = true;
            void aiLogService.finish(invocationLogId, {
              status: 'succeeded',
              output: 'Detached Yoda renderer transport; tmux agent remains running.',
            });
          }
          return;
        }
        this.releaseSilenceReconciler(sessionId, detachSilenceReconciler);
        const exitedBySignal = signal !== undefined && signal !== 0;
        const failed = exitedBySignal || (typeof exitCode === 'number' && exitCode !== 0);
        const exitReason = describeAgentExit({ exitCode, signal });
        const finishAsAgentExit = (exitTail?: string) => {
          if (invocationLogFinished) return;
          invocationLogFinished = true;
          void aiLogService.finish(invocationLogId, {
            status: failed ? 'failed' : 'succeeded',
            error: failed ? exitReason : undefined,
            output: exitTail || undefined,
          });
        };
        if (this.sessions.get(sessionId) !== pty) {
          finishAsAgentExit();
          return;
        }
        // A CLI that dies mid-turn writes no API error and no crash report, so
        // its last screen is the only evidence of why the turn stopped. Exit
        // finalization clears the replay ring buffer, hence the snapshot here,
        // synchronously, before the asynchronous tmux probe below.
        const exitTail = captureAgentExitTail(sessionId);
        // The transport is gone either way, so stop routing input into a dead
        // file descriptor before the probe resolves; `sendInput` falls back to
        // headless `tmux send-keys` exactly as it does for an idle detach.
        this.sessions.delete(sessionId);
        exitClassification = this.classifyLostPtyTransport(sessionId).then((verdict) => {
          if (verdict === 'transport-lost') {
            this.transportDetachedAt.set(sessionId, Date.now());
            if (!invocationLogFinished) {
              invocationLogFinished = true;
              void aiLogService.finish(invocationLogId, {
                status: 'succeeded',
                output: `Lost Yoda renderer transport (${exitReason}); tmux agent remains running.`,
              });
            }
            log.warn('LocalConversation: PTY transport died while the tmux agent stayed alive', {
              sessionId,
              conversationId: conversation.id,
              exitCode,
              signal: signal === undefined ? undefined : String(signal),
            });
            this.cleanupSessionArtifacts(sessionId, pty);
            return verdict;
          }
          finishAsAgentExit(exitTail);
          // The dying screen is the only place a mid-turn CLI death explains
          // itself; keep it in the main log too so a dev session sees it without
          // opening the AI log.
          log.warn('LocalConversation: agent CLI exited', {
            sessionId,
            conversationId: conversation.id,
            runtimeId: conversation.runtimeId,
            exitReason,
            exitTail: exitTail || '(no output captured)',
          });
          // A replacement transport that registered while the probe was in
          // flight owns the run state now; tearing it down here would kill a
          // freshly resumed session.
          if (this.sessions.has(sessionId)) return 'transport-lost';
          void interactiveTurnLogger.onSessionExit(conversation.id);
          this.sessionInfos.delete(sessionId);
          sessionTitleManager.stop(conversation.id);
          this.stopRunStateWatcher(conversation.id);
          markRuntimeSessionExited({
            projectId: conversation.projectId,
            taskId: conversation.taskId,
            conversationId: conversation.id,
          });
          telemetryService.capture('agent_run_finished', {
            provider: conversation.runtimeId,
            exit_code: typeof exitCode === 'number' ? exitCode : -1,
            exit_signal: signal === undefined ? '' : String(signal),
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
          transport: 'local',
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
            transport: 'local',
          });
        } else {
          await tmuxReattachPromise;
        }
        if (!this.ownsPendingStart(sessionId, startToken)) return;
      } else {
        performanceTrace?.mark('tmux-reattach-confirm', {
          skipped: true,
          durationMs: 0,
          transport: 'local',
        });
      }
      const readOnlyResume = Boolean(
        effectiveIsResuming &&
          !reattachExistingTmuxSession &&
          !initialPrompt?.trim() &&
          !pendingImagePaths?.length
      );
      this.sessions.set(sessionId, pty);
      this.sessionInfos.set(sessionId, {
        sessionId,
        conversationId: conversation.id,
        projectId: conversation.projectId,
        taskId: conversation.taskId,
        ...(pty.pid === undefined ? {} : { pid: pty.pid }),
        runtimeId: conversation.runtimeId,
        title: conversation.title,
        ...(readOnlyResume ? { readOnlyResume: true as const } : {}),
      });
      // Transport attachment is not an Agent run-state transition. In particular,
      // a cold resume usually has no `initialPrompt` even when the surviving tmux
      // process is in the middle of a turn. Preserve the existing provider-owned
      // state unless this start actually submits new user input.
      if (initialPrompt?.trim() || pendingImagePaths) {
        agentSessionRuntimeStore.setStatus(
          {
            projectId: conversation.projectId,
            taskId: conversation.taskId,
            conversationId: conversation.id,
          },
          'working'
        );
      }
      if (startupInputPromise) {
        const delivered = await startupInputPromise;
        if (!this.ownsPendingStart(sessionId, startToken)) return;
        if (!delivered) throw new Error(`${conversation.runtimeId} exited before startup input.`);
      }
      if (clipboardInputPromise) {
        await clipboardInputPromise;
        if (!this.ownsPendingStart(sessionId, startToken)) return;
      }
      if (tmuxSessionName) {
        this.tmuxSessionNames.set(sessionId, tmuxSessionName);
      } else {
        this.tmuxSessionNames.delete(sessionId);
      }
      this.transportDetachedAt.delete(sessionId);
      sessionTitleManager.start({
        runtimeId: conversation.runtimeId,
        conversationId: conversation.id,
        projectId: conversation.projectId,
        taskId: conversation.taskId,
        cwd: this.taskPath,
        startedAtMs: titleDiscoveryStartedAtMs,
        isResuming: effectiveIsResuming,
        agentSessionId: effectiveIsResuming ? agentSessionId : undefined,
        stateRoot: titleDiscoveryStateRoot,
        waitForInitialPrompt:
          !effectiveIsResuming && Boolean(effectiveInitialPrompt?.trim() || pendingImagePaths),
        expectedInitialPrompt: effectiveInitialPrompt,
        initialPromptAttemptStartedAtMs: conversation.pendingInitialPrompt
          ? titleDiscoveryStartedAtMs
          : undefined,
      });
      this.startRunStateWatcher(
        conversation,
        sessionStartedAtMs,
        effectiveIsResuming,
        agentSessionId,
        runtimeStateRoot,
        statusMonitor,
        readOnlyResume
      );
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
          transport: 'local',
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
          invocationLogFinished = true;
          void aiLogService.finish(invocationLogIdForRollback, {
            status: 'failed',
            error: startFailed ? 'PTY startup failed' : 'PTY startup cancelled',
          });
        }
      } else if (!startCommitted) {
        preparedSettingsCleanup?.();
        if (invocationLogIdForRollback && !invocationLogFinished) {
          invocationLogFinished = true;
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
    statusMonitor: RuntimeStatusMonitorId,
    readOnlyResume: boolean
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
          readOnlyResume,
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
          // Detached jobs (background shells, monitors, async sub-agents) ride
          // along on the same transcript read. Only this monitor reports them:
          // the `activity` monitor has no transcript tailer, so those sessions
          // simply show no background state.
          onBackgroundJobs: (jobs) => agentSessionRuntimeStore.setBackgroundJobs(session, jobs),
          sessionStartedAtMs: startedAtMs,
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
        watchClaudeSessionActivity(
          { ...activityContext, claudeHomeDir: stateRoot },
          (event) => agentSessionRuntimeStore.dispatch(session, event, 'claude-session-activity'),
          () => agentSessionRuntimeStore.getState(session)
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
   * Ask the tmux pane — not the attach wrapper — whether the agent still runs.
   * A detached transport is Yoda's own doing and says nothing about the agent.
   */
  async isAgentBackendAlive(conversationId: string): Promise<boolean> {
    const sessionId = makePtySessionId(this.projectId, this.taskId, conversationId);
    if (this.sessions.has(sessionId)) return true;
    const tmuxSessionName = this.tmuxSessionNames.get(sessionId);
    if (!tmuxSessionName) return false;
    return (await classifyLostPtyTransport(this.ctx, tmuxSessionName)) === 'transport-lost';
  }

  /**
   * Decide whether a PTY that died on its own took the Agent with it.
   *
   * Yoda's PTY is an `attach-session` wrapper, so for a tmux-backed session the
   * surviving pane — not the dead wrapper — is the source of truth.
   */
  private classifyLostPtyTransport(sessionId: string): Promise<PtyExitClassification> {
    return classifyLostPtyTransport(this.ctx, this.tmuxSessionNames.get(sessionId));
  }

  /** Release only the current tmux attach wrapper after registry revalidation. */
  private detachRendererTransport(sessionId: string, pty: Pty, generation: number): void {
    if (this.sessions.get(sessionId) !== pty || !this.tmuxSessionNames.has(sessionId)) return;
    if (!ptySessionRegistry.detachRendererTransport(sessionId, generation, pty)) return;

    this.intentionallyDetachedPtys.add(pty);
    this.sessions.delete(sessionId);
    this.transportDetachedAt.set(sessionId, Date.now());
    this.releaseSilenceReconciler(sessionId);
    this.cleanupSessionArtifacts(sessionId, pty);
    try {
      pty.kill();
    } catch (error) {
      log.warn('LocalConversation: failed to detach idle tmux transport', {
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
        // Resolve the transport when this turn reaches the head of the queue. A
        // reattach can finish while an earlier send-keys process is in flight;
        // checking here preserves byte order across that handoff.
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
      this.cleanupSessionArtifacts(sessionId, pty);
      ptySessionRegistry.unregister(sessionId);
    }
    for (const sessionId of this.sessionArtifactCleanups.keys()) {
      this.cleanupSessionArtifacts(sessionId);
    }
    for (const info of this.sessionInfos.values()) {
      sessionTitleManager.stop(info.conversationId);
      this.stopRunStateWatcher(info.conversationId);
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
