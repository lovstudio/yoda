import { useInfiniteQuery } from '@tanstack/react-query';
import type { CommandPalettePage, SearchItem, SearchItemKind } from '@shared/search';
import { rpc } from '@renderer/lib/ipc';

const PAGE_SIZE = 25;

/**
 * Offset pages can overlap when a task/session receives activity between page
 * requests and moves earlier in the recency order. Keep the first occurrence:
 * it is the freshest row and gives React/cmdk one stable identity per entity.
 */
export function uniqueScopedSearchItems(pages: CommandPalettePage[]): SearchItem[] {
  const seen = new Set<string>();
  const items: SearchItem[] = [];
  for (const page of pages) {
    for (const item of page.items) {
      const identity = `${item.kind}:${item.id}`;
      if (seen.has(identity)) continue;
      seen.add(identity);
      items.push(item);
    }
  }
  return items;
}

/**
 * Paginated single-kind search backing an infinite-scroll scoped view. Empty
 * query returns recents for the kind; typed query returns FTS/LIKE matches.
 */
export function useScopedSearch(
  kind: SearchItemKind,
  query: string,
  context: { projectId?: string; taskId?: string; workspaceId?: string },
  enabled: boolean
) {
  const q = useInfiniteQuery({
    queryKey: ['cmdk-paged', kind, query, context.projectId, context.taskId, context.workspaceId],
    queryFn: ({ pageParam }) =>
      rpc.search.commandPalettePaged({
        query,
        kind,
        offset: pageParam,
        limit: PAGE_SIZE,
        context,
      }),
    initialPageParam: 0,
    getNextPageParam: (lastPage) => lastPage.nextOffset ?? undefined,
    enabled,
    staleTime: 0,
    placeholderData: (prev) => prev,
  });

  const items = q.data ? uniqueScopedSearchItems(q.data.pages) : [];
  return {
    items,
    hasNextPage: q.hasNextPage,
    isFetchingNextPage: q.isFetchingNextPage,
    fetchNextPage: q.fetchNextPage,
  };
}
