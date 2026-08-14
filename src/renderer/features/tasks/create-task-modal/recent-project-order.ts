/**
 * Most-recently-selected project ids, newest first.
 *
 * The picker used to order by `projects.updated_at`, which moves whenever the
 * database touches a project (task activity, sync, rename) rather than when the
 * user actually picked it. Selection order is what the user remembers, so it
 * wins; `updated_at` stays as the tiebreaker for projects never picked here.
 */
type RecentProjectStorage = Pick<Storage, 'getItem' | 'setItem'>;

const STORAGE_KEY = 'yoda:project-selector:recent-project-ids';
const MAX_RECENT_PROJECTS = 20;

function getStorage(storage?: RecentProjectStorage): RecentProjectStorage | undefined {
  if (storage) return storage;
  if (typeof window === 'undefined') return undefined;

  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

function parseRecentProjectIds(value: string | null): string[] {
  if (!value) return [];

  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];

    return Array.from(
      new Set(parsed.filter((id): id is string => typeof id === 'string' && id.length > 0))
    ).slice(0, MAX_RECENT_PROJECTS);
  } catch {
    return [];
  }
}

export function loadRecentProjectIds(storage?: RecentProjectStorage): string[] {
  try {
    return parseRecentProjectIds(getStorage(storage)?.getItem(STORAGE_KEY) ?? null);
  } catch {
    return [];
  }
}

export function rememberRecentProjectId(
  projectId: string,
  storage?: RecentProjectStorage
): string[] {
  const current = loadRecentProjectIds(storage);
  if (!projectId) return current;

  const next = [projectId, ...current.filter((id) => id !== projectId)].slice(
    0,
    MAX_RECENT_PROJECTS
  );

  try {
    getStorage(storage)?.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Picking a project must keep working when renderer storage is unavailable.
  }

  return next;
}

/** Recently picked projects first (in pick order), then the rest by `updatedAt` desc. */
export function sortProjectsByRecentSelection<T extends { id: string; updatedAt: string }>(
  projects: readonly T[],
  recentProjectIds: readonly string[]
): T[] {
  const rank = new Map(recentProjectIds.map((id, index) => [id, index]));

  return [...projects].sort((a, b) => {
    const rankA = rank.get(a.id) ?? Number.MAX_SAFE_INTEGER;
    const rankB = rank.get(b.id) ?? Number.MAX_SAFE_INTEGER;
    if (rankA !== rankB) return rankA - rankB;
    if (a.updatedAt !== b.updatedAt) return b.updatedAt.localeCompare(a.updatedAt);
    return a.id.localeCompare(b.id);
  });
}
