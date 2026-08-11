export type CommandPaletteQueryMemory = 'task-search';

type QueryStorage = Pick<Storage, 'getItem' | 'setItem'>;

const TASK_SEARCH_QUERY_STORAGE_KEY = 'yoda:command-palette:last-task-search-query';
const RECENT_SEARCHES_STORAGE_KEY = 'yoda:command-palette:recent-searches';
const DEFAULT_TASK_SEARCH_QUERY = 'in:tasks ';
const MAX_RECENT_SEARCHES = 8;

function getQueryStorage(storage?: QueryStorage): QueryStorage | undefined {
  if (storage) return storage;
  if (typeof window === 'undefined') return undefined;

  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

export function resolveInitialCommandPaletteQuery(
  initialQuery: string | undefined,
  queryMemory: CommandPaletteQueryMemory | undefined,
  storage?: QueryStorage
): string {
  if (initialQuery !== undefined) return initialQuery;
  if (queryMemory !== 'task-search') return '';

  try {
    return (
      getQueryStorage(storage)?.getItem(TASK_SEARCH_QUERY_STORAGE_KEY) ?? DEFAULT_TASK_SEARCH_QUERY
    );
  } catch {
    return DEFAULT_TASK_SEARCH_QUERY;
  }
}

export function rememberCommandPaletteQuery(
  query: string,
  queryMemory: CommandPaletteQueryMemory | undefined,
  storage?: QueryStorage
): void {
  if (queryMemory !== 'task-search') return;

  try {
    getQueryStorage(storage)?.setItem(TASK_SEARCH_QUERY_STORAGE_KEY, query);
  } catch {
    // Search should continue to work when renderer storage is unavailable.
  }
}

/** Clears the transient query once the user has acted on a search result. */
export function resetCommandPaletteQuery(
  queryMemory: CommandPaletteQueryMemory | undefined,
  storage?: QueryStorage
): void {
  rememberCommandPaletteQuery('', queryMemory, storage);
}

function parseRecentSearches(value: string | null): string[] {
  if (!value) return [];

  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];

    return Array.from(
      new Set(
        parsed
          .filter((query): query is string => typeof query === 'string')
          .map((query) => query.trim())
          .filter(Boolean)
      )
    ).slice(0, MAX_RECENT_SEARCHES);
  } catch {
    return [];
  }
}

export function loadRecentCommandPaletteQueries(storage?: QueryStorage): string[] {
  try {
    return parseRecentSearches(
      getQueryStorage(storage)?.getItem(RECENT_SEARCHES_STORAGE_KEY) ?? null
    );
  } catch {
    return [];
  }
}

export function rememberRecentCommandPaletteQuery(query: string, storage?: QueryStorage): string[] {
  const normalizedQuery = query.trim();
  const current = loadRecentCommandPaletteQueries(storage);
  if (!normalizedQuery) return current;

  const next = [
    normalizedQuery,
    ...current.filter((recentQuery) => recentQuery !== normalizedQuery),
  ].slice(0, MAX_RECENT_SEARCHES);

  try {
    getQueryStorage(storage)?.setItem(RECENT_SEARCHES_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Keep the in-memory result usable when renderer storage is unavailable.
  }

  return next;
}

export function removeRecentCommandPaletteQuery(query: string, storage?: QueryStorage): string[] {
  const next = loadRecentCommandPaletteQueries(storage).filter(
    (recentQuery) => recentQuery !== query
  );

  try {
    getQueryStorage(storage)?.setItem(RECENT_SEARCHES_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Keep the in-memory result usable when renderer storage is unavailable.
  }

  return next;
}
