import type { AgentSessionConfig } from '@shared/agent-session';
import type { Conversation } from '@shared/conversations';
import { agentSessionExitedChannel } from '@shared/events/agentEvents';
import type { ProjectPromptPrinciples } from '@shared/project-settings';
import { makePtySessionId } from '@shared/ptySessionId';
import { wireAgentClassifier } from '@main/core/agent-hooks/classifier-wiring';
import { claudeTrustService } from '@main/core/agent-hooks/claude-trust-service';
import { agentSessionRuntimeStore } from '@main/core/conversations/agent-session-runtime';
import { agentSilenceReconciler } from '@main/core/conversations/agent-silence-reconciler';
import { createClaudeInterruptSniffer } from '@main/core/conversations/claude-interrupt-sniffer';
import type {
  ActiveConversationSession,
  ConversationProvider,
} from '@main/core/conversations/types';
import type { IExecutionContext } from '@main/core/execution-context/types';
import { SshFileSystem } from '@main/core/fs/impl/ssh-fs';
import type { Pty } from '@main/core/pty/pty';
import { ptySessionRegistry } from '@main/core/pty/pty-session-registry';
import { resolveSshCommand } from '@main/core/pty/spawn-utils';
import { openSsh2Pty } from '@main/core/pty/ssh2-pty';
import { resolveAvailableTmuxSessionName } from '@main/core/pty/tmux-availability';
import { killTmuxSession, sendLiteralToTmuxSession } from '@main/core/pty/tmux-session-name';
import { runtimeOverrideSettings } from '@main/core/settings/runtime-settings-service';
import type { SshClientProxy } from '@main/core/ssh/ssh-client-proxy';
import { events } from '@main/lib/events';
import { log } from '@main/lib/logger';
import { telemetryService } from '@main/lib/telemetry';
import {
  recordConversationAuthProvider,
  snapshotTaskDiffOnSessionExit,
} from '../session-stats-hooks';
import { buildAgentCommand } from './agent-command';
import { substituteImageMentions } from './image-attachments';
import { getEnabledPromptPrinciplesText } from './prompt-principles';
import { resolveRuntimeEnv, resolveRuntimeTmuxEnv } from './runtime-env';

const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;

export class SshConversationProvider implements ConversationProvider {
  private sessions = new Map<string, Pty>();
  private knownSessionIds = new Set<string>();
  private readonly projectId: string;
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
  private readonly tmuxSessionNames = new Map<string, string>();
  private readonly sessionInfos = new Map<string, Omit<ActiveConversationSession, 'detachable'>>();

  constructor({
    projectId,
    taskPath,
    taskId,
    taskEnvVars = {},
    tmux = false,
    shellSetup,
    ctx,
    proxy,
    connectionId,
    resolveProjectPromptPrinciples,
  }: {
    projectId: string;
    taskPath: string;
    taskId: string;
    taskEnvVars?: Record<string, string>;
    tmux?: boolean;
    shellSetup?: string;
    ctx: IExecutionContext;
    proxy: SshClientProxy;
    connectionId: string;
    resolveProjectPromptPrinciples?: () => Promise<ProjectPromptPrinciples | undefined>;
  }) {
    this.projectId = projectId;
    this.taskPath = taskPath;
    this.taskId = taskId;
    this.taskEnvVars = taskEnvVars;
    this.tmux = tmux;
    this.shellSetup = shellSetup;
    this.ctx = ctx;
    this.proxy = proxy;
    this.connectionId = connectionId;
    this.resolveProjectPromptPrinciples = resolveProjectPromptPrinciples;
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

    await claudeTrustService.maybeAutoTrustSsh({
      runtimeId: conversation.runtimeId,
      cwd: this.taskPath,
      ctx: this.ctx,
      remoteFs: new SshFileSystem(this.proxy, '/'),
    });

    const providerConfig = await runtimeOverrideSettings.getItem(conversation.runtimeId);
    recordConversationAuthProvider(conversation.id, providerConfig);
    const { command, args } = buildAgentCommand({
      runtimeId: conversation.runtimeId,
      providerConfig,
      autoApprove: conversation.autoApprove,
      sessionId: conversation.id,
      isResuming,
      // Clipboard paste is local-only; remote sessions get @path mentions.
      initialPrompt: isResuming
        ? initialPrompt
        : substituteImageMentions(initialPrompt, imagePaths ?? []),
      appendSystemPrompt: await getEnabledPromptPrinciplesText(
        await this.resolveProjectPromptPrinciples?.()
      ),
    });

    const tmuxSessionName = await this.resolveTmuxSessionName(sessionId, tmuxOverride);
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
      autoApprove: conversation.autoApprove ?? false,
      resume: isResuming,
    };

    const profile = await this.proxy.getRemoteShellProfile();
    const sshCommand = resolveSshCommand(
      'agent',
      cfg,
      { ...providerEnv, ...this.taskEnvVars },
      profile
    );

    const result = await openSsh2Pty(this.proxy.client, {
      id: sessionId,
      command: sshCommand,
      cols: initialSize.cols,
      rows: initialSize.rows,
    });

    if (!result.success) {
      log.error('SshConversationProvider: failed to open SSH channel', {
        sessionId,
        error: result.error.message,
      });
      return;
    }

    const pty = result.data;

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
      detachSilenceReconciler();
      ptySessionRegistry.unregister(sessionId);
      this.sessions.delete(sessionId);
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
      runtimeId: conversation.runtimeId,
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
    telemetryService.capture('agent_run_started', {
      provider: conversation.runtimeId,
      project_id: conversation.projectId,
      task_id: conversation.taskId,
      conversation_id: conversation.id,
    });
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

  async stopSession(conversationId: string): Promise<void> {
    const sessionId = makePtySessionId(this.projectId, this.taskId, conversationId);
    this.knownSessionIds.delete(sessionId);
    const pty = this.sessions.get(sessionId);
    if (pty) {
      try {
        pty.kill();
      } catch (e) {
        log.warn('SshConversation: error killing PTY', { sessionId, error: String(e) });
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
