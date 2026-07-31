export type CommandPaletteQueryMemory = 'task-search';

type QueryStorage = Pick<Storage, 'getItem' | 'setItem'>;

const TASK_SEARCH_QUERY_STORAGE_KEY = 'yoda:command-palette:last-task-search-query';
const DEFAULT_TASK_SEARCH_QUERY = 'in:tasks ';

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
