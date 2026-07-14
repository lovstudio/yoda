import { requestCodexAppServer } from '@main/core/settings/codex-app-server-client';

const CODEX_FORK_TIMEOUT_MS = 30_000;

export async function forkCodexThread({
  threadId,
  lastTurnId,
  cwd,
}: {
  threadId: string;
  lastTurnId: string;
  cwd: string;
}): Promise<string> {
  const result = await requestCodexAppServer(
    'thread/fork',
    {
      threadId,
      lastTurnId,
      cwd,
      excludeTurns: true,
    },
    { experimentalApi: true, timeoutMs: CODEX_FORK_TIMEOUT_MS }
  );
  const forkedThreadId = readForkedThreadId(result);
  if (!forkedThreadId) {
    throw new Error('Codex thread/fork did not return a thread id.');
  }
  if (forkedThreadId === threadId) {
    throw new Error('Codex thread/fork returned the source thread id.');
  }
  return forkedThreadId;
}

export async function deleteCodexThread(threadId: string): Promise<void> {
  await requestCodexAppServer(
    'thread/delete',
    { threadId },
    { experimentalApi: true, timeoutMs: CODEX_FORK_TIMEOUT_MS }
  );
}

export function readForkedThreadId(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  const thread = (value as Record<string, unknown>).thread;
  if (!thread || typeof thread !== 'object') return null;
  const id = (thread as Record<string, unknown>).id;
  return typeof id === 'string' && id.trim() ? id.trim() : null;
}
