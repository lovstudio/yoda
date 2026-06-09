import { reaction } from 'mobx';
import {
  applyAgentCommandPrefix,
  buildPromptInjectionPayload,
  getAgentCommandSubmitDelayMs,
  getAgentCommandSubmitInput,
  getAgentCommandSubmitSuffix,
} from '@shared/agent-command-prefix';
import type { ConversationStore } from '@renderer/features/tasks/conversations/conversation-manager';
import { asProvisioned, getTaskStore } from '@renderer/features/tasks/stores/task-selectors';
import { rpc } from '@renderer/lib/ipc';
import { log } from '@renderer/utils/logger';

const COMPLETION_TIMEOUT_MS = 10 * 60_000;
const CODEX_COMPLETION_TIMEOUT_MS = 2 * 60_000;
const CODEX_COMPLETION_POLL_MS = 2_000;
const INTERRUPT_INPUT = '\x03';

type RunPreArchiveCommandOptions = {
  signal?: AbortSignal;
};

/**
 * If `command` is non-empty, send it to the explicit conversation and resolve
 * only after the agent has finished (status flips away from `working`). No-op
 * when command is empty / the conversation cannot be found / there is no live
 * conversation. Errors are swallowed-and-logged so archiving can proceed even
 * if the pre-archive step fails.
 */
export async function runPreArchiveCommand(
  projectId: string,
  taskId: string,
  conversationId: string,
  command: string,
  options: RunPreArchiveCommandOptions = {}
): Promise<void> {
  const trimmed = command.trim();
  if (!trimmed) return;
  if (options.signal?.aborted) return;

  const task = getTaskStore(projectId, taskId);
  const provisioned = asProvisioned(task);
  if (!provisioned) return;

  await provisioned.conversations.ensureConversation(conversationId);
  const target = provisioned.conversations.conversations.get(conversationId);
  if (!target) return;

  const normalizedCommand = applyAgentCommandPrefix(target.data.providerId, trimmed);
  const payload = buildPromptInjectionPayload({
    providerId: target.data.providerId,
    text: normalizedCommand,
  });
  if (!payload) return;
  const submitSuffix = getAgentCommandSubmitSuffix(target.data.providerId, normalizedCommand);
  const submitDelayMs = getAgentCommandSubmitDelayMs(target.data.providerId);
  const submitInput = getAgentCommandSubmitInput(target.data.providerId);
  const sessionId = target.session.sessionId;
  const codexBaseline = await getCodexCompletionBaseline(
    projectId,
    taskId,
    target,
    provisioned.path
  );

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
    await rpc.pty.sendInput(sessionId, submitInput);
    await waitForCompletion(target, {
      signal: options.signal,
      codexBaseline,
    });
  } catch (error) {
    if (options.signal?.aborted) return;
    log.warn('runPreArchiveCommand failed', {
      projectId,
      taskId,
      conversationId,
      error: String(error),
    });
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

type CodexCompletionBaseline = {
  cwd: string;
  conversationId: string;
  conversationTitle: string;
  completedTurnCount: number;
};

async function getCodexCompletionBaseline(
  projectId: string,
  taskId: string,
  target: ConversationStore,
  cwd: string | undefined
): Promise<CodexCompletionBaseline | undefined> {
  if (target.data.providerId !== 'codex' || !cwd) return undefined;
  try {
    const sessionInfo = await rpc.conversations
      .getConversationSessionInfo(projectId, taskId, target.data.id, cwd)
      .catch(() => null);
    const codexThreadId = sessionInfo?.sessionId || target.data.id;
    const codexThreadTitle = sessionInfo?.sessionTitle ?? target.data.title;
    const context = await rpc.conversations.getCodexSessionContext(
      cwd,
      codexThreadId,
      codexThreadTitle
    );
    if (!context) return undefined;
    return {
      cwd,
      conversationId: context.threadId || codexThreadId,
      conversationTitle: context.title || codexThreadTitle,
      completedTurnCount: context.completedTurnCount,
    };
  } catch {
    return undefined;
  }
}

function waitForCompletion(
  target: ConversationStore,
  options: { signal?: AbortSignal; codexBaseline?: CodexCompletionBaseline }
): Promise<void> {
  if (target.status !== 'working' || options.signal?.aborted) return Promise.resolve();

  return new Promise((resolve, reject) => {
    let settled = false;
    let dispose: (() => void) | null = null;
    let pollTimeout: ReturnType<typeof setTimeout> | null = null;

    const cleanup = () => {
      if (settled) return;
      settled = true;
      dispose?.();
      options.signal?.removeEventListener('abort', onAbort);
      if (pollTimeout) clearTimeout(pollTimeout);
      clearTimeout(timeout);
    };

    const resolveDone = (source: 'status' | 'codex' | 'abort') => {
      if (source === 'codex' && target.status === 'working') {
        target.setStatus('completed');
      }
      cleanup();
      resolve();
    };

    const onAbort = () => {
      resolveDone('abort');
    };

    const timeout = setTimeout(
      () => {
        cleanup();
        reject(new Error('Timed out waiting for pre-archive command to finish'));
      },
      options.codexBaseline ? CODEX_COMPLETION_TIMEOUT_MS : COMPLETION_TIMEOUT_MS
    );

    options.signal?.addEventListener('abort', onAbort, { once: true });
    dispose = reaction(
      () => target.status !== 'working',
      (done) => {
        if (!done) return;
        resolveDone('status');
      },
      { fireImmediately: true }
    );

    const pollCodexCompletion = () => {
      if (!options.codexBaseline || settled) return;
      void rpc.conversations
        .getCodexSessionContext(
          options.codexBaseline.cwd,
          options.codexBaseline.conversationId,
          options.codexBaseline.conversationTitle
        )
        .then((context) => {
          if (settled) return;
          if (context && context.completedTurnCount > options.codexBaseline!.completedTurnCount) {
            resolveDone('codex');
            return;
          }
          pollTimeout = setTimeout(pollCodexCompletion, CODEX_COMPLETION_POLL_MS);
        })
        .catch(() => {
          if (!settled) pollTimeout = setTimeout(pollCodexCompletion, CODEX_COMPLETION_POLL_MS);
        });
    };
    pollCodexCompletion();
  });
}
