import { randomUUID } from 'node:crypto';
import type {
  AgentAccountRateLimitWindow,
  AgentAccountResetOutcome,
  AgentAccountResetResult,
  AgentAccountUsage,
  RuntimeId,
} from '@shared/runtime-registry';
import { requestCodexAppServer } from './codex-app-server-client';

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
