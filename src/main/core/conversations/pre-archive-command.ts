import {
  appendDeliverySummaryContext,
  inferDeliverySummaryContextPurpose,
  shouldAttachDeliverySummaryContext,
} from '@shared/agent-command-context';
import {
  applyAgentCommandPrefix,
  buildPromptInjectionPayload,
  getAgentCommandSubmitDelayMs,
  getAgentCommandSubmitInput,
  getAgentCommandSubmitSuffix,
} from '@shared/agent-command-prefix';
import {
  agentSessionStatusChangedChannel,
  isAgentSessionRunningStatus,
} from '@shared/events/agentEvents';
import { makePtySessionId } from '@shared/ptySessionId';
import type { RuntimeId } from '@shared/runtime-registry';
import { agentSessionRuntimeStore } from '@main/core/conversations/agent-session-runtime';
import { ptySessionRegistry } from '@main/core/pty/pty-session-registry';
import { events } from '@main/lib/events';
import { log } from '@main/lib/logger';
import { getConversationDeliverySummary } from './session-summary-context';

const COMPLETION_TIMEOUT_MS = 10 * 60_000;
const COMPLETION_POLL_MS = 2_000;

export type AgentCommandTarget = {
  projectId: string;
  taskId: string;
  conversationId: string;
  runtimeId: RuntimeId;
};

/**
 * Inject `command` into the conversation's live PTY and force the session
 * into `working` (a defined edge, so completion is a working→settled
 * transition regardless of prior state; also broadcasts the spinner to the
 * renderer). Returns false when the command is empty or there is no live PTY.
 */
export async function injectAgentCommand(
  target: AgentCommandTarget,
  command: string,
  source: string
): Promise<boolean> {
  const trimmed = command.trim();
  if (!trimmed) return false;

  const pty = ptySessionRegistry.get(
    makePtySessionId(target.projectId, target.taskId, target.conversationId)
  );
  // No live PTY — nothing to run the command against.
  if (!pty) return false;

  const normalizedCommand = applyAgentCommandPrefix(target.runtimeId, trimmed);
  const contextualCommand = await attachDeliverySummaryContext(target, normalizedCommand, source);
  const payload = buildPromptInjectionPayload(contextualCommand);
  if (!payload) return false;

  pty.write(payload);
  const submitSuffix = getAgentCommandSubmitSuffix(target.runtimeId, contextualCommand);
  if (submitSuffix) pty.write(submitSuffix);
  await sleep(getAgentCommandSubmitDelayMs(target.runtimeId));
  pty.write(getAgentCommandSubmitInput(target.runtimeId));

  agentSessionRuntimeStore.dispatch(
    target,
    { kind: 'turn-started', at: Date.now(), force: true },
    source
  );
  return true;
}

async function attachDeliverySummaryContext(
  target: AgentCommandTarget,
  command: string,
  source: string
): Promise<string> {
  if (!shouldAttachDeliverySummaryContext(command)) return command;

  try {
    const summary = await getConversationDeliverySummary(target, { refresh: true });
    return appendDeliverySummaryContext(
      command,
      summary ? [summary] : [],
      inferDeliverySummaryContextPurpose(command)
    );
  } catch (error) {
    log.warn('injectAgentCommand: failed to attach delivery summary', {
      conversationId: target.conversationId,
      source,
      error: String(error),
    });
    return command;
  }
}

/**
 * If `command` is non-empty and the conversation has a live PTY, inject the
 * command into the session and resolve once the agent settles (run state
 * leaves `working`, detected via the stop hook / rollout tailer). Lives in the
 * main process on purpose: the wait must survive renderer reloads — archiving
 * was previously orchestrated in the renderer and silently died on dev
 * hot-reloads. Errors and timeouts are swallowed-and-logged so archiving
 * always proceeds.
 */
export async function runPreArchiveCommand(
  target: AgentCommandTarget,
  command: string
): Promise<void> {
  if (!(await injectAgentCommand(target, command, 'pre-archive'))) return;

  try {
    await waitForSettled(target);
  } catch (error) {
    log.warn('runPreArchiveCommand: completion wait failed', {
      conversationId: target.conversationId,
      error: String(error),
    });
  }
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function waitForSettled(target: AgentCommandTarget): Promise<void> {
  if (!agentSessionRuntimeStore.isRunning(target)) return Promise.resolve();

  return new Promise((resolve, reject) => {
    let settled = false;

    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      offStatusChanged();
      clearInterval(pollTimer);
      clearTimeout(timeout);
      if (error) reject(error);
      else resolve();
    };

    const offStatusChanged = events.on(agentSessionStatusChangedChannel, (event) => {
      if (event.conversationId !== target.conversationId) return;
      if (!isAgentSessionRunningStatus(event.status)) finish();
    });

    // Poll as a belt-and-braces fallback: renderer-originated transitions are
    // not re-broadcast on the status channel, and a dead PTY never emits.
    const pollTimer = setInterval(() => {
      if (!agentSessionRuntimeStore.isRunning(target)) finish();
    }, COMPLETION_POLL_MS);
    pollTimer.unref?.();

    const timeout = setTimeout(() => {
      finish(new Error('Timed out waiting for pre-archive command to finish'));
    }, COMPLETION_TIMEOUT_MS);
    timeout.unref?.();
  });
}
