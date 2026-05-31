import { homedir } from 'node:os';
import { getProvider, type AgentProviderId } from '@shared/agent-provider-registry';
import { agentSessionExitedChannel } from '@shared/events/agentEvents';
import { createRPCController } from '@shared/ipc/rpc';
import { PROJECTLESS_PROJECT_ID } from '@shared/projectless';
import { makePtyId } from '@shared/ptyId';
import { makePtySessionId } from '@shared/ptySessionId';
import { agentHookService } from '@main/core/agent-hooks/agent-hook-service';
import { wireAgentClassifier } from '@main/core/agent-hooks/classifier-wiring';
import { buildAgentCommand } from '@main/core/conversations/impl/agent-command';
import { resolveProviderEnv } from '@main/core/conversations/impl/provider-env';
import { spawnLocalPty } from '@main/core/pty/local-pty';
import { buildAgentEnv } from '@main/core/pty/pty-env';
import { ptySessionRegistry } from '@main/core/pty/pty-session-registry';
import { logLocalPtySpawnWarnings, resolveLocalPtySpawn } from '@main/core/pty/pty-spawn-platform';
import { sessionTitleManager } from '@main/core/session-title/session-title-manager';
import { providerOverrideSettings } from '@main/core/settings/provider-settings-service';
import { events } from '@main/lib/events';
import { log } from '@main/lib/logger';
import { telemetryService } from '@main/lib/telemetry';
import {
  createProjectlessDefaultDirectory,
  resolveProjectlessDefaultDirectory,
} from './projectless-directory';

const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;
const activeProjectlessSessionCwds = new Map<string, string>();

type StartProjectlessSessionParams = {
  taskId: string;
  conversationId: string;
  provider: AgentProviderId;
  title: string;
  initialPrompt?: string;
  autoApprove?: boolean;
};

function buildPromptInjectionPayload(providerId: AgentProviderId, text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return '';
  const hasMultilinePayload = trimmed.includes('\n');
  const shouldUseBracketedPaste = providerId !== 'claude' && hasMultilinePayload;
  return shouldUseBracketedPaste ? `\x1b[200~${trimmed}\x1b[201~` : trimmed;
}

export const projectlessController = createRPCController({
  startSession: async (params: StartProjectlessSessionParams) => {
    const sessionId = makePtySessionId(
      PROJECTLESS_PROJECT_ID,
      params.taskId,
      params.conversationId
    );
    const homeDir = homedir();

    if (ptySessionRegistry.get(sessionId)) {
      const cwd =
        activeProjectlessSessionCwds.get(sessionId) ??
        resolveProjectlessDefaultDirectory({
          homeDir,
          title: params.title,
        });
      return {
        sessionId,
        cwd,
        projectId: PROJECTLESS_PROJECT_ID,
        taskId: params.taskId,
        conversationId: params.conversationId,
      };
    }

    const cwd = await createProjectlessDefaultDirectory({
      homeDir,
      title: params.title,
    });

    const providerConfig = await providerOverrideSettings.getItem(params.provider);
    const { command, args } = buildAgentCommand({
      providerId: params.provider,
      providerConfig,
      autoApprove: params.autoApprove,
      sessionId: params.conversationId,
      isResuming: false,
      initialPrompt: params.initialPrompt,
    });
    const providerEnv = resolveProviderEnv(providerConfig);

    const resolved = resolveLocalPtySpawn({
      platform: process.platform,
      env: process.env,
      intent: {
        kind: 'run-command',
        cwd,
        command: { kind: 'argv', command, args },
      },
    });

    logLocalPtySpawnWarnings('ProjectlessSessionProvider', resolved.warnings, {
      conversationId: params.conversationId,
      sessionId,
    });

    const ptyId = makePtyId(params.provider, params.conversationId);
    const port = agentHookService.getPort();
    const token = agentHookService.getToken();
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
      },
      cols: DEFAULT_COLS,
      rows: DEFAULT_ROWS,
    });

    wireAgentClassifier({
      pty,
      providerId: params.provider,
      projectId: PROJECTLESS_PROJECT_ID,
      taskId: params.taskId,
      conversationId: params.conversationId,
    });

    pty.onExit(({ exitCode }) => {
      ptySessionRegistry.unregister(sessionId);
      activeProjectlessSessionCwds.delete(sessionId);
      sessionTitleManager.stop(params.conversationId);
      telemetryService.capture('agent_run_finished', {
        provider: params.provider,
        exit_code: typeof exitCode === 'number' ? exitCode : -1,
        project_id: PROJECTLESS_PROJECT_ID,
        task_id: params.taskId,
        conversation_id: params.conversationId,
      });
      events.emit(agentSessionExitedChannel, {
        sessionId,
        projectId: PROJECTLESS_PROJECT_ID,
        conversationId: params.conversationId,
        taskId: params.taskId,
        exitCode,
      });
    });

    ptySessionRegistry.register(sessionId, pty);
    activeProjectlessSessionCwds.set(sessionId, cwd);
    sessionTitleManager.start({
      providerId: params.provider,
      conversationId: params.conversationId,
      projectId: PROJECTLESS_PROJECT_ID,
      taskId: params.taskId,
      cwd,
      startedAtMs: sessionStartedAtMs,
      isResuming: false,
    });
    telemetryService.capture('agent_run_started', {
      provider: params.provider,
      project_id: PROJECTLESS_PROJECT_ID,
      task_id: params.taskId,
      conversation_id: params.conversationId,
    });

    const provider = getProvider(params.provider);
    if (provider?.useKeystrokeInjection && params.initialPrompt?.trim()) {
      setTimeout(() => {
        const activePty = ptySessionRegistry.get(sessionId);
        if (!activePty) return;
        const payload = buildPromptInjectionPayload(params.provider, params.initialPrompt ?? '');
        if (!payload) return;
        try {
          activePty.write(payload);
          activePty.write('\r');
        } catch (error) {
          log.warn('ProjectlessSessionProvider: prompt injection failed', {
            sessionId,
            error: String(error),
          });
        }
      }, 1200);
    }

    return {
      sessionId,
      cwd,
      projectId: PROJECTLESS_PROJECT_ID,
      taskId: params.taskId,
      conversationId: params.conversationId,
    };
  },
});
