import {
  buildRemoteShellCommand,
  FALLBACK_REMOTE_SHELL_PROFILE,
  type RemoteShellProfile,
} from '@main/core/ssh/remote-shell-profile';
import type { SshClientProxy } from '@main/core/ssh/ssh-client-proxy';
import { quoteShellArg } from '@main/utils/shellEscape';
import { openSshExecChannel } from './ssh-exec-channel-limiter';
import type { ExecOptions, ExecResult, IExecutionContext } from './types';

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('Aborted', 'AbortError');
}

function waitWithSignal<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(abortReason(signal));

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', onAbort);
      callback();
    };
    const onAbort = () => finish(() => reject(abortReason(signal)));
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => finish(() => resolve(value)),
      (error) => finish(() => reject(error))
    );
  });
}

/**
 * Builds the full shell command string to send over SSH.
 * When `root` is provided the command runs inside `cd root &&`.
 * Args are shell-escaped for safe remote execution.
 */
export function buildSshCommand(
  root: string | undefined,
  command: string,
  args: string[],
  profile?: RemoteShellProfile
): string {
  const escaped = args.map(quoteShellArg).join(' ');
  const inner = args.length ? `${command} ${escaped}` : command;
  const body = root ? `cd ${quoteShellArg(root)} && ${inner}` : inner;
  return buildRemoteShellCommand(profile ?? FALLBACK_REMOTE_SHELL_PROFILE, body);
}

export class SshExecutionContext implements IExecutionContext {
  readonly root?: string;
  readonly supportsLocalSpawn = false;

  private readonly _lifetime = new AbortController();

  constructor(
    private readonly proxy: SshClientProxy,
    opts: { root?: string } = {}
  ) {
    this.root = opts.root;
  }

  async exec(command: string, args: string[] = [], opts: ExecOptions = {}): Promise<ExecResult> {
    const operation = this._operationSignal(opts.signal, opts.timeout);
    try {
      const profile = await waitWithSignal(this.proxy.getRemoteShellProfile(), operation.signal);
      const full = buildSshCommand(this.root, command, args, profile);
      const client = this.proxy.client;
      const stream = await openSshExecChannel(client, full, operation.signal);

      return await new Promise((resolve, reject) => {
        let stdout = '';
        let stderr = '';
        let settled = false;

        const finish = (callback: () => void) => {
          if (settled) return;
          settled = true;
          operation.signal.removeEventListener('abort', onAbort);
          callback();
        };
        const onAbort = () =>
          finish(() => {
            try {
              stream.destroy();
            } catch {}
            reject(abortReason(operation.signal));
          });

        if (operation.signal.aborted) {
          onAbort();
          return;
        }
        operation.signal.addEventListener('abort', onAbort, { once: true });

        stream.on('data', (d: Buffer) => {
          if (!settled) stdout += d.toString('utf-8');
        });
        stream.stderr.on('data', (d: Buffer) => {
          if (!settled) stderr += d.toString('utf-8');
        });

        stream.on('close', (code: number | null) => {
          finish(() => {
            if ((code ?? 0) === 0) {
              resolve({ stdout, stderr });
            } else {
              reject(
                Object.assign(new Error(stderr || `Process exited with code ${code}`), {
                  stdout,
                  stderr,
                })
              );
            }
          });
        });

        stream.on('error', (error: Error) => finish(() => reject(error)));
      });
    } finally {
      operation.dispose();
    }
  }

  async execStreaming(
    command: string,
    args: string[],
    onChunk: (chunk: string) => boolean,
    opts: { signal?: AbortSignal } = {}
  ): Promise<void> {
    const operation = this._operationSignal(opts.signal);
    try {
      const profile = await waitWithSignal(this.proxy.getRemoteShellProfile(), operation.signal);
      const full = buildSshCommand(this.root, command, args, profile);
      const client = this.proxy.client;
      const stream = await openSshExecChannel(client, full, operation.signal);

      await new Promise<void>((resolve, reject) => {
        let settled = false;

        const finish = (callback: () => void) => {
          if (settled) return;
          settled = true;
          operation.signal.removeEventListener('abort', onAbort);
          callback();
        };
        const onAbort = () =>
          finish(() => {
            try {
              stream.destroy();
            } catch {}
            reject(abortReason(operation.signal));
          });

        if (operation.signal.aborted) {
          onAbort();
          return;
        }
        operation.signal.addEventListener('abort', onAbort, { once: true });

        stream.setEncoding('utf8');
        stream.on('data', (chunk: string) => {
          if (settled) return;
          if (!onChunk(chunk)) stream.destroy();
        });
        stream.on('close', () => finish(resolve));
        stream.on('error', (error: Error) => finish(() => reject(error)));
      });
    } finally {
      operation.dispose();
    }
  }

  dispose(): void {
    this._lifetime.abort();
  }

  private _operationSignal(
    callerSignal?: AbortSignal,
    timeoutMs?: number
  ): { signal: AbortSignal; dispose: () => void } {
    const signals: AbortSignal[] = [this._lifetime.signal];
    if (callerSignal) signals.push(callerSignal);
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (timeoutMs !== undefined && timeoutMs > 0) {
      const timeout = new AbortController();
      timer = setTimeout(() => {
        const error = new Error(`Operation timed out after ${timeoutMs}ms`);
        error.name = 'TimeoutError';
        timeout.abort(error);
      }, timeoutMs);
      timer.unref?.();
      signals.push(timeout.signal);
    }
    return {
      signal: AbortSignal.any(signals),
      dispose: () => {
        if (timer) clearTimeout(timer);
      },
    };
  }
}
