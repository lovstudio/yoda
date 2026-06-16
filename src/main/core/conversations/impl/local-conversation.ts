import { homedir } from 'node:os';
import type { Conversation } from '@shared/conversations';
import { agentSessionExitedChannel } from '@shared/events/agentEvents';
import type { ProjectPromptPrinciples } from '@shared/project-settings';
import { makePtyId } from '@shared/ptyId';
import { makePtySessionId } from '@shared/ptySessionId';
import { getRuntime } from '@shared/runtime-registry';
import { agentHookService } from '@main/core/agent-hooks/agent-hook-service';
import { makeCodexNotifyCommand } from '@main/core/agent-hooks/agent-notify-command';
import { wireAgentClassifier } from '@main/core/agent-hooks/classifier-wiring';
import { claudeTrustService } from '@main/core/agent-hooks/claude-trust-service';
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
import type {
  ActiveConversationSession,
  ConversationProvider,
} from '@main/core/conversations/types';
import type { IExecutionContext } from '@main/core/execution-context/types';
import { LocalFileSystem } from '@main/core/fs/impl/local-fs';
import { spawnLocalPty } from '@main/core/pty/local-pty';
import type { Pty } from '@main/core/pty/pty';
import { buildAgentEnv } from '@main/core/pty/pty-env';
import { ptySessionRegistry } from '@main/core/pty/pty-session-registry';
import { logLocalPtySpawnWarnings, resolveLocalPtySpawn } from '@main/core/pty/pty-spawn-platform';
import { resolveAvailableTmuxSessionName } from '@main/core/pty/tmux-availability';
import { killTmuxSession, sendLiteralToTmuxSession } from '@main/core/pty/tmux-session-name';
import { sessionTitleManager } from '@main/core/session-title/session-title-manager';
import { runtimeOverrideSettings } from '@main/core/settings/runtime-settings-service';
import { appSettingsService } from '@main/core/settings/settings-service';
import { events } from '@main/lib/events';
import { log } from '@main/lib/logger';
import { telemetryService } from '@main/lib/telemetry';
import { resolveAgentResumeSessionId } from '../codex-session-id';
import { ensureCodexThreadUnarchived } from '../codex-unarchive';
import {
  recordConversationAuthProvider,
  snapshotTaskDiffOnSessionExit,
} from '../session-stats-hooks';
import { buildAgentCommand } from './agent-command';
import { injectClipboardImagesAndPrompt, substituteImageMentions } from './image-attachments';
import { getEnabledPromptPrinciplesText } from './prompt-principles';
import { resolveAgentApiEnvVars, resolveRuntimeEnv, resolveRuntimeTmuxEnv } from './runtime-env';

const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;

type RunStateWatcher = { stop(): void };

export class LocalConversationProvider implements ConversationProvider {
  private sessions = new Map<string, Pty>();
  private knownSessionIds = new Set<string>();
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
    imagePaths?: string[]
  ): Promise<void> {
    const sessionId = makePtySessionId(
      conversation.projectId,
      conversation.taskId,
      conversation.id
    );
    this.knownSessionIds.add(sessionId);
    if (this.sessions.has(sessionId)) return;

    await claudeTrustService.maybeAutoTrustLocal({
      runtimeId: conversation.runtimeId,
      cwd: this.taskPath,
      homedir: homedir(),
    });
    await this.prepareHookConfig(conversation.runtimeId);
    await applyHookOverrides(
      this.taskPath,
      conversation.runtimeId,
      await hookOverridesStore.get(conversation.taskId)
    );

    const providerConfig = await runtimeOverrideSettings.getItem(conversation.runtimeId);
    recordConversationAuthProvider(conversation.id, providerConfig);
    const agentSessionId = isResuming
      ? resolveAgentResumeSessionId(conversation, this.taskPath)
      : conversation.id;
    if (isResuming) {
      await ensureCodexThreadUnarchived({
        runtimeId: conversation.runtimeId,
        providerConfig,
        threadId: agentSessionId,
        ctx: this.ctx,
      });
    }
    const port = agentHookService.getPort();
    const token = agentHookService.getToken();
    const providerDef = getRuntime(conversation.runtimeId);
    // Image attachments: runtimes with clipboard paste get them injected as
    // native pastes after the TUI boots (so the prompt must NOT go through the
    // CLI arg, or the turn would start before the images land). Everyone else
    // gets @path mentions appended to the prompt.
    const pendingImagePaths = !isResuming && imagePaths?.length ? imagePaths : undefined;
    const useClipboardImagePaste = Boolean(pendingImagePaths && providerDef?.clipboardImagePaste);
    const effectiveInitialPrompt =
      pendingImagePaths && !useClipboardImagePaste
        ? substituteImageMentions(initialPrompt, pendingImagePaths)
        : initialPrompt;
    const { command, args: baseArgs } = buildAgentCommand({
      runtimeId: conversation.runtimeId,
      providerConfig,
      autoApprove: conversation.autoApprove,
      sessionId: agentSessionId,
      isResuming,
      initialPrompt: useClipboardImagePaste ? undefined : effectiveInitialPrompt,
      workingDirectory: this.taskPath,
      appendSystemPrompt: await getEnabledPromptPrinciplesText(
        await this.resolveProjectPromptPrinciples?.()
      ),
    });
    const args = withCodexRuntimeNotifyArgs(conversation.runtimeId, baseArgs, port);

    const tmuxSessionName = await this.resolveTmuxSessionName(sessionId, tmuxOverride);
    const providerEnv = resolveRuntimeEnv(providerConfig, {
      runtimeId: conversation.runtimeId,
      tmuxEnabled: Boolean(tmuxSessionName),
    });

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
        tmuxEnv: resolveRuntimeTmuxEnv(providerEnv),
      },
    });

    logLocalPtySpawnWarnings('LocalConversationProvider', resolved.warnings, {
      conversationId: conversation.id,
      sessionId,
    });

    const ptyId = makePtyId(conversation.runtimeId, conversation.id);
    const sessionStartedAtMs = Date.now();
    const pty = spawnLocalPty({
      id: sessionId,
      command: resolved.command,
      args: resolved.args,
      cwd: resolved.cwd,
      env: {
        ...buildAgentEnv({
          agentApiVars: resolveAgentApiEnvVars(providerConfig, conversation.runtimeId),
          hook: port > 0 ? { port, ptyId, token } : undefined,
          providerVars: providerEnv,
        }),
        ...this.taskEnvVars,
      },
      cols: initialSize.cols,
      rows: initialSize.rows,
    });

    // Log the logical agent command, not the resolved PTY spawn (the tmux
    // wrapper around it is launch plumbing, useless for debugging the run).
    // The initial prompt arg is dropped — it's recorded in the prompt field.
    const invocationLogId = await aiLogService.start({
      purpose: 'interactive-session',
      mode: 'interactive',
      runtime: conversation.runtimeId,
      command: [command, ...args.filter((arg) => arg !== effectiveInitialPrompt)].join(' '),
      prompt: effectiveInitialPrompt ?? null,
      metadata: {
        projectId: conversation.projectId,
        taskId: conversation.taskId,
        conversationId: conversation.id,
        resuming: String(isResuming),
      },
    });

    const hookActive = port > 0;
    const useHooksOnly = hookActive && providerDef?.supportsHooks;

    if (!useHooksOnly) {
      wireAgentClassifier({
        pty,
        runtimeId: conversation.runtimeId,
        projectId: conversation.projectId,
        taskId: conversation.taskId,
        conversationId: conversation.id,
      });
    }

    const detachSilenceReconciler = agentSilenceReconciler.attach(sessionId, {
      projectId: conversation.projectId,
      taskId: conversation.taskId,
      conversationId: conversation.id,
    });
    pty.onData(() => agentSilenceReconciler.noteOutput(sessionId));
    if (conversation.runtimeId === 'claude') {
      // Sub-second Esc-interrupt detection from the TUI's "Interrupted" line.
      pty.onData(
        createClaudeInterruptSniffer({
          projectId: conversation.projectId,
          taskId: conversation.taskId,
          conversationId: conversation.id,
        })
      );
    }

    pty.onExit(({ exitCode }) => {
      if (this.sessions.get(sessionId) !== pty) return;
      void aiLogService.finish(invocationLogId, {
        status: typeof exitCode === 'number' && exitCode !== 0 ? 'failed' : 'succeeded',
        error: typeof exitCode === 'number' && exitCode !== 0 ? `Exit code ${exitCode}` : undefined,
      });
      void interactiveTurnLogger.onSessionExit(conversation.id);
      detachSilenceReconciler();
      ptySessionRegistry.unregister(sessionId);
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
      events.emit(agentSessionExitedChannel, {
        sessionId,
        projectId: conversation.projectId,
        conversationId: conversation.id,
        taskId: conversation.taskId,
        exitCode,
      });
      snapshotTaskDiffOnSessionExit(conversation.taskId);
    });

    ptySessionRegistry.register(sessionId, pty);
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
      isResuming,
    });
    this.startRunStateWatcher(conversation, sessionStartedAtMs, isResuming);
    telemetryService.capture('agent_run_started', {
      provider: conversation.runtimeId,
      project_id: conversation.projectId,
      task_id: conversation.taskId,
      conversation_id: conversation.id,
    });
  }

  /**
   * Attach a deterministic run-state source that tails the transcript the CLI
   * writes itself — the authoritative turn-started/ended signal, independent of
   * how the user submits and of hook delivery. Codex tails its rollout JSONL;
   * Claude tails its session transcript. No-op for other providers (they fall
   * back to the classifier).
   */
  private startRunStateWatcher(
    conversation: Conversation,
    startedAtMs: number,
    isResuming: boolean
  ): void {
    this.stopRunStateWatcher(conversation.id);
    const session = {
      projectId: conversation.projectId,
      taskId: conversation.taskId,
      conversationId: conversation.id,
    };
    if (conversation.runtimeId === 'codex') {
      const watcher = watchCodexRunState(
        { conversationId: conversation.id, cwd: this.taskPath, startedAtMs, isResuming },
        (event) => agentSessionRuntimeStore.dispatch(session, event, 'codex-rollout')
      );
      this.runStateWatchers.set(conversation.id, [watcher]);
      return;
    }
    if (conversation.runtimeId === 'claude') {
      const processPid = this.getSessionProcessPid(conversation.id);
      const activityContext =
        processPid === undefined
          ? { conversationId: conversation.id, cwd: this.taskPath }
          : { conversationId: conversation.id, cwd: this.taskPath, processPid };
      this.runStateWatchers.set(conversation.id, [
        watchClaudeRunState(
          { conversationId: conversation.id, cwd: this.taskPath },
          (event) => agentSessionRuntimeStore.dispatch(session, event, 'claude-transcript'),
          () => agentSessionRuntimeStore.getStatus(session)
        ),
        watchClaudeSessionActivity(activityContext, (event) =>
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

  private async prepareHookConfig(runtimeId: Conversation['runtimeId']): Promise<void> {
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

  async stopSession(conversationId: string): Promise<void> {
    const sessionId = makePtySessionId(this.projectId, this.taskId, conversationId);
    this.knownSessionIds.delete(sessionId);
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
      ptySessionRegistry.unregister(sessionId);
    }
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
    for (const [sessionId, pty] of this.sessions) {
      const conversationId = sessionId.split(':').pop();
      if (conversationId) {
        sessionTitleManager.stop(conversationId);
        this.stopRunStateWatcher(conversationId);
      }
      try {
        pty.kill();
      } catch {}
      ptySessionRegistry.unregister(sessionId);
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
