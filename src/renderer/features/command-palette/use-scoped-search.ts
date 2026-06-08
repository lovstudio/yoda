import { useInfiniteQuery } from '@tanstack/react-query';
import type { SearchItem, SearchItemKind } from '@shared/search';
import { rpc } from '@renderer/lib/ipc';

const PAGE_SIZE = 25;

/**
 * Paginated single-kind search backing an infinite-scroll scoped view. Empty
 * query returns recents for the kind; typed query returns FTS/LIKE matches.
 */
export function useScopedSearch(
  kind: SearchItemKind,
  query: string,
  context: { projectId?: string; taskId?: string },
  enabled: boolean
) {
  const q = useInfiniteQuery({
    queryKey: ['cmdk-paged', kind, query, context.projectId, context.taskId],
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

  const items: SearchItem[] = q.data?.pages.flatMap((p) => p.items) ?? [];
  return {
    items,
    hasNextPage: q.hasNextPage,
    isFetchingNextPage: q.isFetchingNextPage,
    fetchNextPage: q.fetchNextPage,
  };
}
