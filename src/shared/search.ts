export type SearchItemKind = 'task' | 'project' | 'conversation';

export interface SearchItem {
  kind: SearchItemKind;
  id: string;
  projectId: string | null;
  taskId: string | null;
  title: string;
  subtitle: string;
  score: number;
  /** True when the item itself or its owning task is archived. */
  archived?: boolean;
  /** Conversation results: true when the owning task is archived. */
  taskArchived?: boolean;
  /** Conversation results: true when the conversation row itself is archived. */
  conversationArchived?: boolean;
  /** ISO timestamp of last activity (task/conversation) or last update (project). */
  timestamp?: string | null;
}

export interface CommandPaletteQuery {
  query: string;
  context?: {
    projectId?: string;
    taskId?: string;
    /**
     * Restricts task results to a sidebar workspace (`in:workspace`). A real
     * workspace id, or DEFAULT_WORKSPACE_ID for tasks with no workspace assigned.
     */
    workspaceId?: string;
  };
}

/** Paginated single-kind query for a scoped (infinite-scroll) palette view. */
export interface CommandPalettePagedQuery {
  query: string;
  kind: SearchItemKind;
  offset: number;
  limit: number;
  context?: {
    projectId?: string;
    taskId?: string;
    /** See CommandPaletteQuery.context.workspaceId. */
    workspaceId?: string;
  };
}

export interface CommandPalettePage {
  items: SearchItem[];
  /** Offset to pass for the next page, or null when there are no more items. */
  nextOffset: number | null;
}

/**
 * Canonical palette ordering for result lists assembled in JS: active before
 * archived, then newest first (matching the timestamp rendered on each row),
 * with the source's own relevance score as the tiebreak. SQL-side result sets
 * order by the same rule in their ORDER BY clauses.
 */
export function compareSearchItems(a: SearchItem, b: SearchItem): number {
  const archived = Number(a.archived ?? false) - Number(b.archived ?? false);
  if (archived !== 0) return archived;
  // ISO timestamps compare lexicographically; undated ('') sorts last.
  const at = a.timestamp ?? '';
  const bt = b.timestamp ?? '';
  if (at !== bt) return at < bt ? 1 : -1;
  // Lower score is better (BM25 rank, or the source's hit order).
  return a.score - b.score;
}
