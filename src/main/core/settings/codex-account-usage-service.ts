import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type {
  AgentAccountRateLimitWindow,
  AgentAccountResetOutcome,
  AgentAccountResetResult,
  AgentAccountUsage,
  RuntimeId,
} from '@shared/runtime-registry';

const REQUEST_TIMEOUT_MS = 10_000;

type JsonRpcResponse = {
  id?: number;
  result?: unknown;
  error?: { message?: unknown };
};

type CodexRateLimitResponse = {
  rateLimits?: unknown;
  rateLimitResetCredits?: unknown;
};

export async function getCodexAccountUsage(): Promise<AgentAccountUsage> {
  const fetchedAt = new Date().toISOString();
  try {
    const result = await requestCodexAppServer('account/rateLimits/read', {});
    const parsed = parseCodexRateLimits(result);
    return { runtimeId: 'codex', supported: true, ...parsed, fetchedAt, error: null };
  } catch (error) {
    return {
      runtimeId: 'codex',
      supported: true,
      rateLimits: [],
      resetCreditsAvailable: null,
      fetchedAt,
      error: error instanceof Error ? error.message : 'Failed to read Codex account usage.',
    };
  }
}

export async function resetCodexAccountUsage(): Promise<AgentAccountResetResult> {
  try {
    const result = await requestCodexAppServer('account/rateLimitResetCredit/consume', {
      idempotencyKey: randomUUID(),
    });
    return {
      runtimeId: 'codex',
      supported: true,
      outcome: parseCodexResetOutcome(result),
      error: null,
    };
  } catch (error) {
    return {
      runtimeId: 'codex',
      supported: true,
      outcome: null,
      error: error instanceof Error ? error.message : 'Failed to reset Codex account usage.',
    };
  }
}

export function getAccountUsage(id: RuntimeId): Promise<AgentAccountUsage> {
  if (id === 'codex') return getCodexAccountUsage();
  return Promise.resolve({
    runtimeId: id,
    supported: false,
    rateLimits: [],
    resetCreditsAvailable: null,
    fetchedAt: new Date().toISOString(),
    error: null,
  });
}

export function resetAccountUsage(id: RuntimeId): Promise<AgentAccountResetResult> {
  if (id === 'codex') return resetCodexAccountUsage();
  return Promise.resolve({
    runtimeId: id,
    supported: false,
    outcome: null,
    error: null,
  });
}

function requestCodexAppServer(method: string, params: Record<string, unknown>): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const child = spawn('codex', ['app-server', '--stdio'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
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
          finish(new Error(readRpcError(response.error, 'Codex account usage request failed.')));
          return;
        }
        finish(null, response.result);
      }
    };
    const timeout = setTimeout(
      () => finish(new Error('Timed out while reading Codex account usage.')),
      REQUEST_TIMEOUT_MS
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
      if (!settled) {
        const detail = stderr.trim();
        finish(
          new Error(
            detail ||
              `Codex app-server exited before returning account usage (code ${code ?? '?'}).`
          )
        );
      }
    });

    write({
      id: 1,
      method: 'initialize',
      params: { clientInfo: { name: 'yoda', title: 'Yoda', version: '0.15.3' } },
    });
  });
}

export function parseCodexResetOutcome(value: unknown): AgentAccountResetOutcome {
  const outcome = objectValue(value)?.outcome;
  if (
    outcome === 'reset' ||
    outcome === 'nothingToReset' ||
    outcome === 'noCredit' ||
    outcome === 'alreadyRedeemed'
  ) {
    return outcome;
  }
  throw new Error('Codex returned an unknown account reset outcome.');
}

function readRpcError(error: { message?: unknown }, fallback: string): string {
  return typeof error.message === 'string' && error.message ? error.message : fallback;
}

export function parseCodexRateLimits(value: unknown): {
  rateLimits: AgentAccountRateLimitWindow[];
  resetCreditsAvailable: number | null;
} {
  const response = objectValue(value) as CodexRateLimitResponse | null;
  const snapshot = objectValue(response?.rateLimits);
  const rateLimits = [snapshot?.primary, snapshot?.secondary].flatMap((item) => {
    const window = objectValue(item);
    const windowMinutes = numberValue(window?.windowDurationMins);
    const usedPercent = numberValue(window?.usedPercent);
    if (windowMinutes == null || windowMinutes <= 0 || usedPercent == null || usedPercent < 0) {
      return [];
    }
    const resetsAt = numberValue(window?.resetsAt);
    return [
      {
        windowMinutes,
        usedPercent,
        resetsAt: resetsAt != null && resetsAt > 0 ? new Date(resetsAt * 1000).toISOString() : null,
      },
    ];
  });
  const resetCredits = objectValue(response?.rateLimitResetCredits);
  const availableCount = numberValue(resetCredits?.availableCount);
  return {
    rateLimits,
    resetCreditsAvailable:
      availableCount != null && Number.isInteger(availableCount) && availableCount >= 0
        ? availableCount
        : null,
  };
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
