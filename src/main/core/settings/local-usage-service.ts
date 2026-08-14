import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AgentLocalUsage, RuntimeId } from '@shared/runtime-registry';
import { TTLCache } from '@main/core/utils/ttl-cache';
import { log } from '@main/lib/logger';
import { readFileTail } from '@main/utils/file-lines';
import { getModelPricing } from './model-pricing';

const USAGE_LOOKBACK_DAYS = 30;
const USAGE_CACHE_TTL_MS = 5 * 60 * 1_000;
/** Codex rollout files end with a cumulative token_count event; the tail is enough. */
const CODEX_TAIL_BYTES = 1024 * 1024;

type UsageTotals = Pick<
  AgentLocalUsage,
  | 'sessionCount'
  | 'inputTokens'
  | 'outputTokens'
  | 'cacheReadTokens'
  | 'cacheCreationTokens'
  | 'costUsd'
  | 'unpricedModels'
>;

function emptyTotals(): UsageTotals {
  return {
    sessionCount: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    costUsd: 0,
    unpricedModels: [],
  };
}

function cutoffDate(): Date {
  return new Date(Date.now() - USAGE_LOOKBACK_DAYS * 24 * 60 * 60 * 1_000);
}

async function listJsonlFiles(root: string, since: Date): Promise<string[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(root, { recursive: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  const files: string[] = [];
  for (const entry of entries) {
    if (!entry.endsWith('.jsonl')) continue;
    const filePath = path.join(root, entry);
    try {
      const stat = await fs.stat(filePath);
      if (stat.isFile() && stat.mtime >= since) files.push(filePath);
    } catch {
      // File disappeared mid-scan; skip it.
    }
  }
  return files;
}

/**
 * Claude Code writes one JSONL per session under `~/.claude/projects/<slug>/`.
 * Assistant entries carry `message.usage`; the same message id can be written
 * multiple times while streaming, so entries are deduped by message/request id.
 */
async function readClaudeUsage(): Promise<UsageTotals> {
  const since = cutoffDate();
  const sinceIso = since.toISOString();
  const files = await listJsonlFiles(path.join(os.homedir(), '.claude', 'projects'), since);
  const totals = emptyTotals();
  const seen = new Set<string>();
  const unpriced = new Set<string>();

  for (const filePath of files) {
    let content: string;
    try {
      content = await fs.readFile(filePath, 'utf8');
    } catch {
      continue;
    }
    let counted = false;
    for (const line of content.split('\n')) {
      if (!line.includes('"type":"assistant"')) continue;
      let entry: {
        type?: string;
        timestamp?: string;
        requestId?: string;
        costUSD?: number;
        message?: {
          id?: string;
          model?: string;
          usage?: {
            input_tokens?: number;
            output_tokens?: number;
            cache_read_input_tokens?: number;
            cache_creation_input_tokens?: number;
            cache_creation?: {
              ephemeral_5m_input_tokens?: number;
              ephemeral_1h_input_tokens?: number;
            };
          };
        };
      };
      try {
        entry = JSON.parse(line) as typeof entry;
      } catch {
        continue;
      }
      const usage = entry.message?.usage;
      if (entry.type !== 'assistant' || !usage) continue;
      if (entry.timestamp && entry.timestamp < sinceIso) continue;
      if (entry.message?.id) {
        const key = `${entry.message.id}:${entry.requestId ?? ''}`;
        if (seen.has(key)) continue;
        seen.add(key);
      }
      const input = usage.input_tokens ?? 0;
      const output = usage.output_tokens ?? 0;
      const cacheRead = usage.cache_read_input_tokens ?? 0;
      const cacheWrite = usage.cache_creation_input_tokens ?? 0;
      totals.inputTokens += input;
      totals.outputTokens += output;
      totals.cacheReadTokens += cacheRead;
      totals.cacheCreationTokens += cacheWrite;
      counted = true;

      // ccusage "auto" mode: trust Claude Code's own costUSD when present,
      // otherwise price the tokens from the bundled table.
      if (typeof entry.costUSD === 'number') {
        totals.costUsd += entry.costUSD;
        continue;
      }
      const model = entry.message?.model ?? '';
      const pricing = model ? getModelPricing(model) : null;
      if (!pricing) {
        // '<synthetic>' marks Claude Code placeholder entries, not a real model.
        if (model && model !== '<synthetic>' && input + output + cacheRead + cacheWrite > 0) {
          unpriced.add(model);
        }
        continue;
      }
      const cacheWrite5m =
        usage.cache_creation?.ephemeral_5m_input_tokens ??
        cacheWrite - (usage.cache_creation?.ephemeral_1h_input_tokens ?? 0);
      const cacheWrite1h = usage.cache_creation?.ephemeral_1h_input_tokens ?? 0;
      totals.costUsd +=
        (input * pricing.input +
          output * pricing.output +
          cacheWrite5m * (pricing.cacheWrite5m ?? pricing.input * 1.25) +
          cacheWrite1h * (pricing.cacheWrite1h ?? pricing.input * 2) +
          cacheRead * (pricing.cacheRead ?? pricing.input * 0.1)) /
        1_000_000;
    }
    if (counted) totals.sessionCount += 1;
  }
  totals.unpricedModels = [...unpriced];
  return totals;
}

/**
 * Codex rollout files log cumulative `token_count` events; the last one in a
 * file is that session's total. `input_tokens` already includes the cached
 * share reported in `cached_input_tokens`.
 */
function findLastJsonLine<T>(lines: string[], marker: string): T | null {
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i].includes(marker)) continue;
    try {
      return JSON.parse(lines[i]) as T;
    } catch {
      continue;
    }
  }
  return null;
}

async function readCodexUsage(): Promise<UsageTotals> {
  const since = cutoffDate();
  const files = await listJsonlFiles(path.join(os.homedir(), '.codex', 'sessions'), since);
  const totals = emptyTotals();
  const unpriced = new Set<string>();

  for (const filePath of files) {
    let tail: string;
    try {
      tail = (await readFileTail(filePath, CODEX_TAIL_BYTES)).text;
    } catch {
      continue;
    }
    const lines = tail.split('\n');
    const countEntry = findLastJsonLine<{
      payload?: {
        type?: string;
        info?: {
          total_token_usage?: {
            input_tokens?: number;
            cached_input_tokens?: number;
            output_tokens?: number;
          };
        };
      };
    }>(lines, '"token_count"');
    const usage =
      countEntry?.payload?.type === 'token_count'
        ? countEntry.payload.info?.total_token_usage
        : undefined;
    if (!usage) continue;

    const cached = usage.cached_input_tokens ?? 0;
    const input = Math.max(0, (usage.input_tokens ?? 0) - cached);
    const output = usage.output_tokens ?? 0;
    totals.inputTokens += input;
    totals.cacheReadTokens += cached;
    totals.outputTokens += output;
    totals.sessionCount += 1;

    const turnContext = findLastJsonLine<{ payload?: { type?: string; model?: string } }>(
      lines,
      '"turn_context"'
    );
    const model = turnContext?.payload?.model ?? '';
    const pricing = model ? getModelPricing(model) : null;
    if (!pricing) {
      if (input + output + cached > 0) unpriced.add(model || 'unknown');
      continue;
    }
    totals.costUsd +=
      (input * pricing.input +
        cached * (pricing.cacheRead ?? pricing.input * 0.1) +
        output * pricing.output) /
      1_000_000;
  }
  totals.unpricedModels = [...unpriced];
  return totals;
}

const USAGE_READERS: Partial<Record<RuntimeId, () => Promise<UsageTotals>>> = {
  claude: readClaudeUsage,
  codex: readCodexUsage,
};

const usageCache = new Map<RuntimeId, TTLCache<AgentLocalUsage>>();

export async function getLocalUsage(
  id: RuntimeId,
  args?: { forceRefresh?: boolean }
): Promise<AgentLocalUsage> {
  const base: AgentLocalUsage = {
    runtimeId: id,
    supported: false,
    days: USAGE_LOOKBACK_DAYS,
    ...emptyTotals(),
    fetchedAt: new Date().toISOString(),
    error: null,
  };
  const reader = USAGE_READERS[id];
  if (!reader) return base;

  let cache = usageCache.get(id);
  if (!cache) {
    cache = new TTLCache<AgentLocalUsage>(USAGE_CACHE_TTL_MS);
    usageCache.set(id, cache);
  }
  if (args?.forceRefresh) cache.invalidate();

  return cache.get(async () => {
    try {
      return { ...base, supported: true, ...(await reader()) };
    } catch (error) {
      log.warn(`Failed to read local usage for ${id}:`, error);
      return {
        ...base,
        supported: true,
        error: error instanceof Error ? error.message : 'Failed to read local usage.',
      };
    }
  });
}
