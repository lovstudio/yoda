export type SkillUsageStats = {
  count: number;
  lastUsedAt: string | null;
  /** Local-date key (YYYY-MM-DD) → invocations that day; pruned to the last year. */
  daily: Record<string, number>;
};

export const skillUsageStatsChangedEvent = 'yoda:skill-usage-stats-changed';

const STORAGE_KEY = 'yoda.skillUsageStats.v2';
/** v1 stored only {count, lastUsedAt}; read once as a migration fallback. */
const LEGACY_STORAGE_KEY = 'yoda.skillUsageStats.v1';
const DAILY_RETENTION_DAYS = 366;
const EMPTY_STATS: SkillUsageStats = { count: 0, lastUsedAt: null, daily: {} };

type StoredSkillUsageStats = Record<string, SkillUsageStats>;

function getStorage(): Storage | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage ?? null;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Local-time calendar date key (YYYY-MM-DD), matching the usage heatmap's bucketing. */
export function localDateKey(date: Date): string {
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

function normalizeDaily(value: unknown): Record<string, number> {
  if (!isObjectRecord(value)) return {};
  const daily: Record<string, number> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) continue;
    if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) continue;
    daily[key] = Math.floor(raw);
  }
  return daily;
}

function normalizeStats(value: unknown): SkillUsageStats {
  if (!isObjectRecord(value)) return EMPTY_STATS;

  const count = typeof value.count === 'number' && Number.isFinite(value.count) ? value.count : 0;
  const lastUsedAt = typeof value.lastUsedAt === 'string' ? value.lastUsedAt : null;
  return { count: Math.max(0, Math.floor(count)), lastUsedAt, daily: normalizeDaily(value.daily) };
}

function parseStats(raw: string | null): StoredSkillUsageStats | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!isObjectRecord(parsed)) return null;
    return Object.fromEntries(
      Object.entries(parsed).map(([skillId, stats]) => [skillId, normalizeStats(stats)])
    );
  } catch {
    return null;
  }
}

function readStats(): StoredSkillUsageStats {
  const storage = getStorage();
  if (!storage) return {};

  try {
    return (
      parseStats(storage.getItem(STORAGE_KEY)) ??
      // v1 entries carry over with an empty daily history.
      parseStats(storage.getItem(LEGACY_STORAGE_KEY)) ??
      {}
    );
  } catch {
    return {};
  }
}

function writeStats(stats: StoredSkillUsageStats): void {
  const storage = getStorage();
  if (!storage) return;

  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(stats));
  } catch {
    // Best-effort local UI stat; quota or storage failures should not affect prompting.
  }
}

function pruneDaily(daily: Record<string, number>, now: Date): Record<string, number> {
  const cutoff = localDateKey(new Date(now.getTime() - DAILY_RETENTION_DAYS * 24 * 60 * 60 * 1000));
  // Date keys are zero-padded ISO dates, so string comparison is chronological.
  return Object.fromEntries(Object.entries(daily).filter(([key]) => key >= cutoff));
}

export function getSkillUsageStats(skillId: string): SkillUsageStats {
  return readStats()[skillId] ?? EMPTY_STATS;
}

export function recordSkillInvocation(skillId: string): SkillUsageStats {
  const normalizedSkillId = skillId.trim();
  if (!normalizedSkillId) return EMPTY_STATS;

  const now = new Date();
  const todayKey = localDateKey(now);
  const stats = readStats();
  const previous = stats[normalizedSkillId] ?? EMPTY_STATS;
  const daily = pruneDaily(previous.daily, now);
  daily[todayKey] = (daily[todayKey] ?? 0) + 1;
  const next: SkillUsageStats = {
    count: previous.count + 1,
    lastUsedAt: now.toISOString(),
    daily,
  };
  stats[normalizedSkillId] = next;
  writeStats(stats);

  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent(skillUsageStatsChangedEvent, { detail: { skillId: normalizedSkillId } })
    );
  }

  return next;
}
