import type { SkillUsageIndex, SkillUsageStat } from '@shared/skills/types';
import { execCommand } from '@main/core/app/utils';
import { KV } from '@main/db/kv';

const CACHE_TTL_MS = 5 * 60_000;
/** The first incremental-index build still scans all local histories. */
const SCAN_TIMEOUT_MS = 120_000;

interface SkillusageRow {
  skill?: string;
  total?: number;
  manual?: number;
  auto?: number;
  lastUsedAt?: string | null;
  daily?: Record<string, number>;
  aliases?: string[];
}

interface SkillUsageKVSchema extends Record<string, unknown> {
  snapshot: SkillUsageIndex;
}

export interface SkillUsageSnapshotStore {
  get(): Promise<SkillUsageIndex | null>;
  set(snapshot: SkillUsageIndex): Promise<void>;
}

function isSkillUsageIndex(value: unknown): value is SkillUsageIndex {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<SkillUsageIndex>;
  return (
    typeof candidate.generatedAt === 'string' &&
    typeof candidate.bySkill === 'object' &&
    candidate.bySkill !== null &&
    !Array.isArray(candidate.bySkill)
  );
}

function parseSkillUsageOutput(stdout: string): SkillUsageIndex {
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

  return {
    generatedAt: parsed.generatedAt ?? new Date().toISOString(),
    bySkill,
  };
}

export class SkillUsageStatsService {
  private cache: { fetchedAt: number; data: SkillUsageIndex } | null = null;
  private refreshPromise: Promise<SkillUsageIndex> | null = null;

  constructor(
    private readonly runSkillusage: () => Promise<string>,
    private readonly snapshotStore: SkillUsageSnapshotStore
  ) {}

  async get(refresh = false): Promise<SkillUsageIndex> {
    if (!refresh) {
      if (this.cache && Date.now() - this.cache.fetchedAt < CACHE_TTL_MS) {
        return this.cache.data;
      }

      const persisted = await this.snapshotStore.get();
      if (isSkillUsageIndex(persisted)) {
        this.cache = { fetchedAt: Date.now(), data: persisted };
        return persisted;
      }
    }

    return this.refresh();
  }

  private refresh(): Promise<SkillUsageIndex> {
    if (this.refreshPromise) return this.refreshPromise;

    const refreshPromise = this.scanAndPersist();
    this.refreshPromise = refreshPromise;
    void refreshPromise.then(
      () => {
        if (this.refreshPromise === refreshPromise) this.refreshPromise = null;
      },
      () => {
        if (this.refreshPromise === refreshPromise) this.refreshPromise = null;
      }
    );
    return refreshPromise;
  }

  private async scanAndPersist(): Promise<SkillUsageIndex> {
    const data = parseSkillUsageOutput(await this.runSkillusage());
    this.cache = { fetchedAt: Date.now(), data };
    await this.snapshotStore.set(data);
    return data;
  }
}

const snapshotKV = new KV<SkillUsageKVSchema>('skill-usage');
const skillUsageStatsService = new SkillUsageStatsService(
  () =>
    execCommand('skillusage --json', {
      timeout: SCAN_TIMEOUT_MS,
      maxBuffer: 32 * 1024 * 1024,
    }),
  {
    get: () => snapshotKV.get('snapshot'),
    set: (snapshot) => snapshotKV.set('snapshot', snapshot),
  }
);

/**
 * Spawns the skillusage CLI (https://github.com/lovstudio/skillusage) and
 * indexes its JSON output by skill name and aliases for catalog lookups. The
 * latest successful snapshot is persisted so renderer startup never waits for
 * a history scan after the first run.
 */
export async function getSkillUsageStats(refresh = false): Promise<SkillUsageIndex> {
  return skillUsageStatsService.get(refresh);
}
