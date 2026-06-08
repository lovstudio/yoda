import { homedir } from 'node:os';
import { getProvider } from '@shared/agent-provider-registry';
import type { Conversation } from '@shared/conversations';
import { agentSessionExitedChannel } from '@shared/events/agentEvents';
import { makePtyId } from '@shared/ptyId';
import { makePtySessionId } from '@shared/ptySessionId';
import { agentHookService } from '@main/core/agent-hooks/agent-hook-service';
import { makeCodexNotifyCommand } from '@main/core/agent-hooks/agent-notify-command';
import { wireAgentClassifier } from '@main/core/agent-hooks/classifier-wiring';
import { claudeTrustService } from '@main/core/agent-hooks/claude-trust-service';
import { HookConfigWriter } from '@main/core/agent-hooks/hook-config';
import { applyHookOverrides } from '@main/core/agent-hooks/inspect/hook-overrides-apply';
import { hookOverridesStore } from '@main/core/agent-hooks/inspect/hook-overrides-store';
import { agentSessionRuntimeStore } from '@main/core/conversations/agent-session-runtime';
import {
  watchClaudeRunState,
  type ClaudeRunStateWatcher,
} from '@main/core/conversations/claude-run-state-source';
import {
  watchCodexRunState,
  type CodexRunStateWatcher,
} from '@main/core/conversations/codex-run-state-source';
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
import { killTmuxSession } from '@main/core/pty/tmux-session-name';
import { sessionTitleManager } from '@main/core/session-title/session-title-manager';
import { providerOverrideSettings } from '@main/core/settings/provider-settings-service';
import { appSettingsService } from '@main/core/settings/settings-service';
import { events } from '@main/lib/events';
import { log } from '@main/lib/logger';
import { telemetryService } from '@main/lib/telemetry';
import { resolveAgentResumeSessionId } from '../codex-session-id';
import { ensureCodexThreadUnarchived } from '../codex-unarchive';
import { buildAgentCommand } from './agent-command';
import { resolveProviderEnv, resolveProviderTmuxEnv } from './provider-env';

const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;

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
  private readonly hookConfigWriter: HookConfigWriter;
  private readonly preparedHookProviders = new Map<string, boolean>();
  private readonly tmuxSessionNames = new Map<string, string>();
  private readonly sessionInfos = new Map<string, Omit<ActiveConversationSession, 'detachable'>>();
  private readonly runStateWatchers = new Map<
    string,
    CodexRunStateWatcher | ClaudeRunStateWatcher
  >();

  constructor({
    projectId,
    taskPath,
    taskId,
    tmux = false,
    shellSetup,
    ctx,
    taskEnvVars = {},
  }: {
    projectId: string;
    taskPath: string;
    taskId: string;
    tmux?: boolean;
    shellSetup?: string;
    ctx: IExecutionContext;
    taskEnvVars?: Record<string, string>;
  }) {
    this.projectId = projectId;
    this.taskPath = taskPath;
    this.taskId = taskId;
    this.tmux = tmux;
    this.shellSetup = shellSetup;
    this.ctx = ctx;
    this.taskEnvVars = taskEnvVars;
    this.hookConfigWriter = new HookConfigWriter(new LocalFileSystem(taskPath), ctx);
  }

  async startSession(
    conversation: Conversation,
    initialSize: { cols: number; rows: number } = { cols: DEFAULT_COLS, rows: DEFAULT_ROWS },
    isResuming: boolean = false,
    initialPrompt?: string,
    tmuxOverride?: boolean
  ): Promise<void> {
    const sessionId = makePtySessionId(
      conversation.projectId,
      conversation.taskId,
      conversation.id
    );
    this.knownSessionIds.add(sessionId);
    if (this.sessions.has(sessionId)) return;

    await claudeTrustService.maybeAutoTrustLocal({
      providerId: conversation.providerId,
      cwd: this.taskPath,
      homedir: homedir(),
    });
    await this.prepareHookConfig(conversation.providerId);
    await applyHookOverrides(
      this.taskPath,
      conversation.providerId,
      await hookOverridesStore.get(conversation.taskId)
    );

    const providerConfig = await providerOverrideSettings.getItem(conversation.providerId);
    const agentSessionId = isResuming
      ? resolveAgentResumeSessionId(conversation, this.taskPath)
      : conversation.id;
    if (isResuming) {
      await ensureCodexThreadUnarchived({
        providerId: conversation.providerId,
        providerConfig,
        threadId: agentSessionId,
        ctx: this.ctx,
      });
    }
    const port = agentHookService.getPort();
    const token = agentHookService.getToken();
    const { command, args: baseArgs } = buildAgentCommand({
      providerId: conversation.providerId,
      providerConfig,
      autoApprove: conversation.autoApprove,
      sessionId: agentSessionId,
      isResuming,
      initialPrompt,
      workingDirectory: this.taskPath,
    });
    const args = withCodexRuntimeNotifyArgs(conversation.providerId, baseArgs, port);

    const tmuxSessionName = await this.resolveTmuxSessionName(sessionId, tmuxOverride);
    const providerEnv = resolveProviderEnv(providerConfig, {
      providerId: conversation.providerId,
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
        tmuxEnv: resolveProviderTmuxEnv(providerEnv),
      },
    });

    logLocalPtySpawnWarnings('LocalConversationProvider', resolved.warnings, {
      conversationId: conversation.id,
      sessionId,
    });

    const ptyId = makePtyId(conversation.providerId, conversation.id);
    const sessionStartedAtMs = Date.now();
    const pty = spawnLocalPty({
      id: sessionId,
      command: resolved.command,
      args: resolved.args,
      cwd: resolved.cwd,
      env: {
        ...buildAgentEnv({
          hook: port > 0 ? { port, ptyId, token } : undefined,
          providerVars: providerEnv,
        }),
        ...this.taskEnvVars,
      },
      cols: initialSize.cols,
      rows: initialSize.rows,
    });

    const hookActive = port > 0;
    const provider = getProvider(conversation.providerId);
    const useHooksOnly = hookActive && provider?.supportsHooks;

    if (!useHooksOnly) {
      wireAgentClassifier({
        pty,
        providerId: conversation.providerId,
        projectId: conversation.projectId,
        taskId: conversation.taskId,
        conversationId: conversation.id,
      });
    }

    pty.onExit(({ exitCode }) => {
      if (this.sessions.get(sessionId) !== pty) return;
      ptySessionRegistry.unregister(sessionId);
      this.sessions.delete(sessionId);
      this.sessionInfos.delete(sessionId);
      this.stopRunStateWatcher(conversation.id);
      agentSessionRuntimeStore.remove({
        projectId: conversation.projectId,
        taskId: conversation.taskId,
        conversationId: conversation.id,
      });
      telemetryService.capture('agent_run_finished', {
        provider: conversation.providerId,
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
    });

    ptySessionRegistry.register(sessionId, pty);
    this.sessions.set(sessionId, pty);
    this.sessionInfos.set(sessionId, {
      sessionId,
      conversationId: conversation.id,
      projectId: conversation.projectId,
      taskId: conversation.taskId,
      providerId: conversation.providerId,
      title: conversation.title,
    });
    agentSessionRuntimeStore.setStatus(
      {
        projectId: conversation.projectId,
        taskId: conversation.taskId,
        conversationId: conversation.id,
      },
      initialPrompt?.trim() ? 'working' : 'idle'
    );
    if (tmuxSessionName) this.tmuxSessionNames.set(sessionId, tmuxSessionName);
    sessionTitleManager.start({
      providerId: conversation.providerId,
      conversationId: conversation.id,
      projectId: conversation.projectId,
      taskId: conversation.taskId,
      cwd: this.taskPath,
      startedAtMs: sessionStartedAtMs,
      isResuming,
    });
    this.startRunStateWatcher(conversation, sessionStartedAtMs);
    telemetryService.capture('agent_run_started', {
      provider: conversation.providerId,
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
  private startRunStateWatcher(conversation: Conversation, startedAtMs: number): void {
    this.stopRunStateWatcher(conversation.id);
    const session = {
      projectId: conversation.projectId,
      taskId: conversation.taskId,
      conversationId: conversation.id,
    };
    if (conversation.providerId === 'codex') {
      const watcher = watchCodexRunState(
        { conversationId: conversation.id, cwd: this.taskPath, startedAtMs },
        (event) => agentSessionRuntimeStore.dispatch(session, event, 'codex-rollout')
      );
      this.runStateWatchers.set(conversation.id, watcher);
      return;
    }
    if (conversation.providerId === 'claude') {
      const watcher = watchClaudeRunState(
        { conversationId: conversation.id, cwd: this.taskPath },
        (event) => agentSessionRuntimeStore.dispatch(session, event, 'claude-transcript')
      );
      this.runStateWatchers.set(conversation.id, watcher);
    }
  }

  private stopRunStateWatcher(conversationId: string): void {
    const watcher = this.runStateWatchers.get(conversationId);
    if (!watcher) return;
    try {
      watcher.stop();
    } catch {}
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

  private async prepareHookConfig(providerId: Conversation['providerId']): Promise<void> {
    try {
      const localProjectSettings = await appSettingsService.get('localProject');
      const writeGitIgnoreEntries = localProjectSettings.writeAgentConfigToGitIgnore ?? true;
      const previousWriteGitIgnoreEntries = this.preparedHookProviders.get(providerId);
      const shouldPrepareHookConfig =
        previousWriteGitIgnoreEntries === undefined ||
        (!previousWriteGitIgnoreEntries && writeGitIgnoreEntries);
      if (!shouldPrepareHookConfig) return;

      await this.hookConfigWriter.writeForProvider(providerId, {
        writeGitIgnoreEntries,
      });
      this.preparedHookProviders.set(providerId, writeGitIgnoreEntries);
    } catch (error) {
      log.warn('LocalConversationProvider: failed to prepare hook config', {
        providerId,
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
        log.warn('LocalAgentProvider: error killing PTY', { sessionId, error: String(e) });
      }
      this.sessions.delete(sessionId);
      ptySessionRegistry.unregister(sessionId);
    }
    this.sessionInfos.delete(sessionId);
    agentSessionRuntimeStore.remove({
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

function withCodexRuntimeNotifyArgs(
  providerId: Conversation['providerId'],
  args: string[],
  hookPort: number
): string[] {
  if (providerId !== 'codex' || hookPort <= 0) return args;
  return ['-c', `notify=${tomlArray(makeCodexNotifyCommand())}`, ...args];
}

function tomlArray(values: string[]): string {
  return `[${values.map((value) => JSON.stringify(value)).join(',')}]`;
}
