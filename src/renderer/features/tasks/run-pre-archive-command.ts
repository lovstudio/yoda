import { reaction } from 'mobx';
import {
  applyAgentCommandPrefix,
  getAgentCommandSubmitDelayMs,
  getAgentCommandSubmitSuffix,
} from '@shared/agent-command-prefix';
import type {
  ConversationManagerStore,
  ConversationStore,
} from '@renderer/features/tasks/conversations/conversation-manager';
import { asProvisioned, getTaskStore } from '@renderer/features/tasks/stores/task-selectors';
import { rpc } from '@renderer/lib/ipc';
import { buildPromptInjectionPayload } from '@renderer/lib/pty/prompt-injection';
import { log } from '@renderer/utils/logger';

const COMPLETION_TIMEOUT_MS = 10 * 60_000;
const SUBMIT_INPUT = '\r';
const INTERRUPT_INPUT = '\x03';

type RunPreArchiveCommandOptions = {
  signal?: AbortSignal;
};

/**
 * If `command` is non-empty, send it to the task's most-recently-used
 * conversation and resolve only after the agent has finished (status flips
 * away from `working`). No-op when command is empty / there is no live
 * conversation. Errors are swallowed-and-logged so archiving can proceed even
 * if the pre-archive step fails.
 */
export async function runPreArchiveCommand(
  projectId: string,
  taskId: string,
  command: string,
  options: RunPreArchiveCommandOptions = {}
): Promise<void> {
  const trimmed = command.trim();
  if (!trimmed) return;
  if (options.signal?.aborted) return;

  const task = getTaskStore(projectId, taskId);
  const provisioned = asProvisioned(task);
  if (!provisioned) return;

  const target = pickTargetConversation(provisioned.conversations);
  if (!target) return;

  const normalizedCommand = applyAgentCommandPrefix(target.data.providerId, trimmed);
  const payload = buildPromptInjectionPayload({
    providerId: target.data.providerId,
    text: normalizedCommand,
  });
  if (!payload) return;
  const submitSuffix = getAgentCommandSubmitSuffix(target.data.providerId, normalizedCommand);
  const submitDelayMs = getAgentCommandSubmitDelayMs(target.data.providerId);
  const sessionId = target.session.sessionId;

  const interrupt = () => {
    void rpc.pty.sendInput(sessionId, INTERRUPT_INPUT).catch(() => {});
    target.clearWorking();
  };

  try {
    options.signal?.addEventListener('abort', interrupt, { once: true });
    if (options.signal?.aborted) return;
    target.setWorking();
    if (options.signal?.aborted) return;
    await rpc.pty.sendInput(sessionId, payload);
    if (options.signal?.aborted) return;
    if (submitSuffix) {
      await rpc.pty.sendInput(sessionId, submitSuffix);
      if (options.signal?.aborted) return;
    }
    await sleep(submitDelayMs, options.signal);
    if (options.signal?.aborted) return;
    await rpc.pty.sendInput(sessionId, SUBMIT_INPUT);
    await waitForCompletion(target, options.signal);
  } catch (error) {
    if (options.signal?.aborted) return;
    log.warn('runPreArchiveCommand failed', { projectId, taskId, error: String(error) });
  } finally {
    options.signal?.removeEventListener('abort', interrupt);
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0 || signal?.aborted) return Promise.resolve();

  return new Promise((resolve) => {
    const timeout = setTimeout(done, ms);

    function done() {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', done);
      resolve();
    }

    signal?.addEventListener('abort', done, { once: true });
  });
}

function waitForCompletion(target: ConversationStore, signal?: AbortSignal): Promise<void> {
  if (target.status !== 'working' || signal?.aborted) return Promise.resolve();

  return new Promise((resolve, reject) => {
    let settled = false;
    let dispose: (() => void) | null = null;

    const cleanup = () => {
      if (settled) return;
      settled = true;
      dispose?.();
      signal?.removeEventListener('abort', onAbort);
      clearTimeout(timeout);
    };

    const onAbort = () => {
      cleanup();
      resolve();
    };

    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('Timed out waiting for pre-archive command to finish'));
    }, COMPLETION_TIMEOUT_MS);

    signal?.addEventListener('abort', onAbort, { once: true });
    dispose = reaction(
      () => target.status !== 'working',
      (done) => {
        if (!done) return;
        cleanup();
        resolve();
      },
      { fireImmediately: true }
    );
  });
}

function pickTargetConversation(manager: ConversationManagerStore): ConversationStore | undefined {
  let bestStore: ConversationStore | undefined;
  let bestLast = -Infinity;
  for (const store of manager.conversations.values()) {
    const last = store.data.lastInteractedAt ? Date.parse(store.data.lastInteractedAt) : 0;
    if (last > bestLast) {
      bestLast = last;
      bestStore = store;
    }
  }
  return bestStore;
}
