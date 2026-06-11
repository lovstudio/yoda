import type { SkillUsageIndex, SkillUsageStat } from '@shared/skills/types';
import { execCommand } from '@main/core/app/utils';

const CACHE_TTL_MS = 5 * 60_000;
/** Scanning ~/.claude + ~/.codex takes a few seconds on large histories. */
const SCAN_TIMEOUT_MS = 60_000;

let cache: { fetchedAt: number; data: SkillUsageIndex } | null = null;

interface SkillusageRow {
  skill?: string;
  total?: number;
  manual?: number;
  auto?: number;
  lastUsedAt?: string | null;
  daily?: Record<string, number>;
  aliases?: string[];
}

/**
 * Spawns the skillusage CLI (https://github.com/lovstudio/skillusage) and
 * indexes its JSON output by skill name and aliases for catalog lookups.
 */
export async function getSkillUsageStats(refresh = false): Promise<SkillUsageIndex> {
  if (!refresh && cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) return cache.data;

  const stdout = await execCommand('skillusage --json', {
    timeout: SCAN_TIMEOUT_MS,
    maxBuffer: 32 * 1024 * 1024,
  });
  // skillusage prints a one-line banner before the JSON payload.
  const jsonStart = stdout.indexOf('{');
  if (jsonStart === -1) throw new Error('skillusage returned no JSON output');
  const parsed = JSON.parse(stdout.slice(jsonStart)) as {
    generatedAt?: string;
    skills?: SkillusageRow[];
  };

  const bySkill: Record<string, SkillUsageStat> = {};
  for (const row of parsed.skills ?? []) {
    if (typeof row.skill !== 'string') continue;
    const stat: SkillUsageStat = {
      skill: row.skill,
      total: row.total ?? 0,
      manual: row.manual ?? 0,
      auto: row.auto ?? 0,
      lastUsedAt: row.lastUsedAt ?? null,
      daily: row.daily ?? {},
    };
    for (const key of [row.skill, ...(row.aliases ?? [])]) {
      const lookupKey = key.toLowerCase();
      const existing = bySkill[lookupKey];
      if (!existing || stat.total > existing.total) bySkill[lookupKey] = stat;
    }
  }

  const data: SkillUsageIndex = {
    generatedAt: parsed.generatedAt ?? new Date().toISOString(),
    bySkill,
  };
  cache = { fetchedAt: Date.now(), data };
  return data;
}
