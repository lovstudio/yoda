import { EventEmitter } from 'node:events';
import type { Client, ClientChannel } from 'ssh2';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SSH_EXEC_CHANNEL_OPEN_CONCURRENCY } from '@main/core/execution-context/ssh-exec-channel-limiter';
import { SshExecutionContext } from '@main/core/execution-context/ssh-execution-context';
import { FALLBACK_REMOTE_SHELL_PROFILE } from '@main/core/ssh/remote-shell-profile';
import type { SshClientProxy } from '@main/core/ssh/ssh-client-proxy';
import { cleanupDetachedSessions, TASK_SESSION_CLEANUP_KILL_TIMEOUT_MS } from './task-manager';

const mocks = vi.hoisted(() => ({
  getPages: vi.fn(),
}));

vi.mock('@main/core/tasks/session-targets', () => ({
  getTaskSessionLeafIdPages: mocks.getPages,
}));

vi.mock('@main/db/client', () => ({
  db: {},
  sqlite: {},
}));

vi.mock('@main/lib/logger', () => ({
  log: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

class FakeSshStream extends EventEmitter {
  readonly stderr = new EventEmitter();
  readonly destroy = vi.fn();
  readonly setEncoding = vi.fn();
}

type ExecCallback = (error: Error | undefined, stream: ClientChannel) => void;

class HangingSshClient {
  readonly callbacks: ExecCallback[] = [];
  pendingOpens = 0;
  maxPendingOpens = 0;

  readonly exec = vi.fn((_command: string, callback: ExecCallback) => {
    this.pendingOpens += 1;
    this.maxPendingOpens = Math.max(this.maxPendingOpens, this.pendingOpens);
    this.callbacks.push((error, stream) => {
      this.pendingOpens -= 1;
      callback(error, stream);
    });
  });
}

function makeProxy(client: HangingSshClient): SshClientProxy {
  return {
    client: client as unknown as Client,
    getRemoteShellProfile: vi.fn().mockResolvedValue(FALLBACK_REMOTE_SHELL_PROFILE),
  } as unknown as SshClientProxy;
}

async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 6; index += 1) await Promise.resolve();
}

afterEach(() => {
  vi.useRealTimers();
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('fallback task cleanup over SSH', () => {
  it('keeps real channel opens bounded across timeouts and pages without retaining expired queue entries', async () => {
    vi.useFakeTimers();
    mocks.getPages.mockImplementation(async function* () {
      yield {
        conversationIds: Array.from({ length: 16 }, (_, index) => `conversation-${index}`),
        terminalIds: [],
      };
      yield {
        conversationIds: [],
        terminalIds: Array.from({ length: 8 }, (_, index) => `terminal-${index}`),
      };
    });

    const client = new HangingSshClient();
    const ctx = new SshExecutionContext(makeProxy(client));
    const execSpy = vi.spyOn(ctx, 'exec');
    const cleanup = cleanupDetachedSessions('project-1', 'task-1', ctx);

    await flushMicrotasks();
    expect(client.exec).toHaveBeenCalledTimes(SSH_EXEC_CHANNEL_OPEN_CONCURRENCY);

    await vi.advanceTimersByTimeAsync(TASK_SESSION_CLEANUP_KILL_TIMEOUT_MS * 4);
    await expect(cleanup).resolves.toBeUndefined();

    // All 24 logical kills reach the execution context, but only the original
    // eight can be opening on the live client. Later batches expire in the
    // queue and must not accumulate or open after their public timeout.
    expect(execSpy).toHaveBeenCalledTimes(24);
    expect(client.exec).toHaveBeenCalledTimes(SSH_EXEC_CHANNEL_OPEN_CONCURRENCY);
    expect(client.maxPendingOpens).toBe(SSH_EXEC_CHANNEL_OPEN_CONCURRENCY);

    const expiredStreams = client.callbacks.map(() => new FakeSshStream());
    client.callbacks.forEach((callback, index) => {
      callback(undefined, expiredStreams[index] as unknown as ClientChannel);
    });
    await flushMicrotasks();
    expect(expiredStreams.every((stream) => stream.destroy.mock.calls.length === 1)).toBe(true);
    expect(client.exec).toHaveBeenCalledTimes(SSH_EXEC_CHANNEL_OPEN_CONCURRENCY);

    // Releasing the genuinely pending opens admits fresh work immediately;
    // none of the 16 expired queued kills are retained ahead of it.
    const followUp = ctx.exec('true');
    await flushMicrotasks();
    expect(client.exec).toHaveBeenCalledTimes(SSH_EXEC_CHANNEL_OPEN_CONCURRENCY + 1);
    const followUpStream = new FakeSshStream();
    client.callbacks.at(-1)?.(undefined, followUpStream as unknown as ClientChannel);
    await flushMicrotasks();
    followUpStream.emit('close', 0);
    await expect(followUp).resolves.toEqual({ stdout: '', stderr: '' });
  });
});
