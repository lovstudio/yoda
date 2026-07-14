import { spawn } from 'node:child_process';
import { buildAgentEnv } from '@main/core/pty/pty-env';
import { buildAgentSubcommand } from '../conversations/impl/agent-command';
import { resolveAgentApiEnvVars, resolveRuntimeEnv } from '../conversations/impl/runtime-env';
import { runtimeOverrideSettings } from './runtime-settings-service';

const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;

type JsonRpcResponse = {
  id?: number;
  result?: unknown;
  error?: { message?: unknown };
};

export type CodexAppServerRequestOptions = {
  /** Required for request fields marked experimental by the installed Codex version. */
  experimentalApi?: boolean;
  timeoutMs?: number;
};

/**
 * Executes one request against a short-lived Codex app-server process.
 *
 * The account-usage and conversation-fork flows intentionally share this
 * handshake so protocol changes cannot silently diverge between callers.
 */
export async function requestCodexAppServer(
  method: string,
  params: Record<string, unknown>,
  options: CodexAppServerRequestOptions = {}
): Promise<unknown> {
  const providerConfig = await runtimeOverrideSettings.getItem('codex');
  const command = buildAgentSubcommand({
    runtimeId: 'codex',
    providerConfig,
    subcommand: 'app-server',
    subcommandArgs: ['--stdio'],
  });
  const env = buildAgentEnv({
    agentApiVars: resolveAgentApiEnvVars(providerConfig, 'codex'),
    providerVars: resolveRuntimeEnv(providerConfig, { runtimeId: 'codex' }),
  });

  return new Promise((resolve, reject) => {
    const child = spawn(command.command, command.args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      env,
    });
    let stdout = '';
    let stderr = '';
    let settled = false;

    const finish = (error: Error | null, value?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      child.kill();
      if (error) reject(error);
      else resolve(value);
    };
    const write = (message: object) => child.stdin.write(`${JSON.stringify(message)}\n`);
    const handleLine = (line: string) => {
      let response: JsonRpcResponse;
      try {
        response = JSON.parse(line) as JsonRpcResponse;
      } catch {
        return;
      }
      if (response.id === 1) {
        if (response.error) {
          finish(
            new Error(readRpcError(response.error, 'Codex app-server initialization failed.'))
          );
          return;
        }
        write({ method: 'initialized', params: {} });
        write({ id: 2, method, params });
      } else if (response.id === 2) {
        if (response.error) {
          finish(new Error(readRpcError(response.error, `Codex app-server ${method} failed.`)));
          return;
        }
        finish(null, response.result);
      }
    };
    const timeout = setTimeout(
      () => finish(new Error(`Timed out while waiting for Codex app-server ${method}.`)),
      options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS
    );

    child.on('error', (error) => finish(error));
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
      let newline = stdout.indexOf('\n');
      while (newline >= 0) {
        const line = stdout.slice(0, newline).trim();
        stdout = stdout.slice(newline + 1);
        if (line) handleLine(line);
        newline = stdout.indexOf('\n');
      }
    });
    child.on('exit', (code) => {
      if (settled) return;
      const detail = stderr.trim();
      finish(
        new Error(
          detail || `Codex app-server exited before ${method} completed (code ${code ?? '?'}).`
        )
      );
    });

    write({
      id: 1,
      method: 'initialize',
      params: {
        clientInfo: { name: 'yoda', title: 'Yoda', version: '0.15.3' },
        ...(options.experimentalApi ? { capabilities: { experimentalApi: true } } : {}),
      },
    });
  });
}

function readRpcError(error: { message?: unknown }, fallback: string): string {
  return typeof error.message === 'string' && error.message ? error.message : fallback;
}
