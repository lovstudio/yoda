import { EventEmitter } from 'node:events';
import type { Client, ClientChannel } from 'ssh2';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { killTmuxSession, TMUX_KILL_TIMEOUT_MS } from '@main/core/pty/tmux-session-name';
import {
  FALLBACK_REMOTE_SHELL_PROFILE,
  type RemoteShellProfile,
} from '@main/core/ssh/remote-shell-profile';
import type { SshClientProxy } from '@main/core/ssh/ssh-client-proxy';
import { SSH_EXEC_CHANNEL_OPEN_CONCURRENCY } from './ssh-exec-channel-limiter';
import { buildSshCommand, SshExecutionContext } from './ssh-execution-context';

class FakeSshStream extends EventEmitter {
  readonly stderr = new EventEmitter();
  readonly destroy = vi.fn();
  readonly setEncoding = vi.fn();
}

type ExecCallback = (error: Error | undefined, stream: ClientChannel) => void;

class FakeSshClient {
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

function makeProxy(client: FakeSshClient): SshClientProxy {
  return {
    client: client as unknown as Client,
    getRemoteShellProfile: vi.fn().mockResolvedValue(FALLBACK_REMOTE_SHELL_PROFILE),
  } as unknown as SshClientProxy;
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

afterEach(() => {
  vi.useRealTimers();
});

describe('buildSshCommand', () => {
  it('uses the shared remote shell command builder for fallback SSH exec commands', () => {
    const command = buildSshCommand('/workspace/project', 'which', ['claude']);

    expect(command).toBe(
      "'/bin/sh' -c 'cd '\\''/workspace/project'\\'' && which '\\''claude'\\'''"
    );
  });

  it('uses the remote shell profile and cwd when building SSH exec commands', () => {
    const profile: RemoteShellProfile = {
      shell: '/bin/zsh',
      env: {
        PATH: '/Users/jona/.local/bin:/opt/homebrew/bin:/usr/bin',
      },
    };

    const command = buildSshCommand('/workspace/project', 'which', ['claude'], profile);

    expect(command).toBe(
      "'/bin/zsh' -lc 'export PATH='\\''/Users/jona/.local/bin:/opt/homebrew/bin:/usr/bin'\\''; cd '\\''/workspace/project'\\'' && which '\\''claude'\\'''"
    );
  });
});

describe('SshExecutionContext cancellation and channel limiting', () => {
  it('propagates exec timeout to an opened SSH stream', async () => {
    vi.useFakeTimers();
    const client = new FakeSshClient();
    const ctx = new SshExecutionContext(makeProxy(client));
    const promise = ctx.exec('tmux', ['kill-session'], { timeout: 5_000 });
    const rejection = expect(promise).rejects.toThrow('Operation timed out after 5000ms');

    await flushMicrotasks();
    const stream = new FakeSshStream();
    client.callbacks[0]?.(undefined, stream as unknown as ClientChannel);
    await flushMicrotasks();

    await vi.advanceTimersByTimeAsync(5_000);
    await rejection;
    expect(stream.destroy).toHaveBeenCalledOnce();
  });

  it('shares the open limit by live client and never opens queued calls after timeout', async () => {
    vi.useFakeTimers();
    const client = new FakeSshClient();
    const first = new SshExecutionContext(makeProxy(client));
    const second = new SshExecutionContext(makeProxy(client));
    const calls = Array.from({ length: SSH_EXEC_CHANNEL_OPEN_CONCURRENCY + 6 }, (_, index) =>
      (index % 2 === 0 ? first : second).exec('tmux', [`session-${index}`], { timeout: 5_000 })
    );
    const outcomes = Promise.allSettled(calls);

    await flushMicrotasks();
    expect(client.exec).toHaveBeenCalledTimes(SSH_EXEC_CHANNEL_OPEN_CONCURRENCY);
    expect(client.maxPendingOpens).toBe(SSH_EXEC_CHANNEL_OPEN_CONCURRENCY);

    await vi.advanceTimersByTimeAsync(5_000);
    const results = await outcomes;
    expect(results.every((result) => result.status === 'rejected')).toBe(true);

    // Public timeouts do not free real opens whose ssh2 callbacks are still
    // pending, and the expired queued calls are removed rather than opening
    // later when those callbacks finally arrive.
    expect(client.exec).toHaveBeenCalledTimes(SSH_EXEC_CHANNEL_OPEN_CONCURRENCY);
    const expiredStreams = client.callbacks.map(() => new FakeSshStream());
    client.callbacks.forEach((callback, index) => {
      callback(undefined, expiredStreams[index] as unknown as ClientChannel);
    });
    await flushMicrotasks();
    expect(client.exec).toHaveBeenCalledTimes(SSH_EXEC_CHANNEL_OPEN_CONCURRENCY);
    expect(expiredStreams.every((stream) => stream.destroy.mock.calls.length === 1)).toBe(true);

    const followUp = first.exec('tmux', ['fresh-session']);
    await flushMicrotasks();
    expect(client.exec).toHaveBeenCalledTimes(SSH_EXEC_CHANNEL_OPEN_CONCURRENCY + 1);
    const followUpStream = new FakeSshStream();
    client.callbacks.at(-1)?.(undefined, followUpStream as unknown as ClientChannel);
    await flushMicrotasks();
    followUpStream.emit('close', 0);
    await expect(followUp).resolves.toEqual({ stdout: '', stderr: '' });
    expect(client.maxPendingOpens).toBe(SSH_EXEC_CHANNEL_OPEN_CONCURRENCY);
  });

  it('does not open an SSH channel when the caller is already aborted', async () => {
    const client = new FakeSshClient();
    const ctx = new SshExecutionContext(makeProxy(client));
    const controller = new AbortController();
    controller.abort(new Error('cancelled'));

    await expect(ctx.exec('tmux', [], { signal: controller.signal })).rejects.toThrow('cancelled');
    expect(client.exec).not.toHaveBeenCalled();
  });

  it('keeps repeated default tmux kill timeouts from opening queued channels later', async () => {
    vi.useFakeTimers();
    const client = new FakeSshClient();
    const first = new SshExecutionContext(makeProxy(client));
    const second = new SshExecutionContext(makeProxy(client));
    const kills = Array.from({ length: SSH_EXEC_CHANNEL_OPEN_CONCURRENCY + 4 }, (_, index) =>
      killTmuxSession(index % 2 === 0 ? first : second, `session-${index}`)
    );

    await flushMicrotasks();
    expect(client.exec).toHaveBeenCalledTimes(SSH_EXEC_CHANNEL_OPEN_CONCURRENCY);
    await vi.advanceTimersByTimeAsync(TMUX_KILL_TIMEOUT_MS);
    await expect(Promise.all(kills)).resolves.toHaveLength(SSH_EXEC_CHANNEL_OPEN_CONCURRENCY + 4);
    expect(client.exec).toHaveBeenCalledTimes(SSH_EXEC_CHANNEL_OPEN_CONCURRENCY);

    const expiredStreams = client.callbacks.map(() => new FakeSshStream());
    client.callbacks.forEach((callback, index) => {
      callback(undefined, expiredStreams[index] as unknown as ClientChannel);
    });
    await flushMicrotasks();
    expect(client.exec).toHaveBeenCalledTimes(SSH_EXEC_CHANNEL_OPEN_CONCURRENCY);
    expect(expiredStreams.every((stream) => stream.destroy.mock.calls.length === 1)).toBe(true);
  });
});
