import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import type { MaasConnectInput, MaasInvocationFilterKind, MaasPlatformId } from '@shared/maas';
import { rpc } from '@renderer/lib/ipc';

const PAGE_SIZE = 24;
const REAL_USAGE_QUERY_VERSION = 'zenmux-management-statistics-v2';

export const maasQueryKeys = {
  connections: ['maas', 'connections'] as const,
  records: (platformId: MaasPlatformId, kind: MaasInvocationFilterKind, refreshSequence = 0) =>
    ['maas', 'records', REAL_USAGE_QUERY_VERSION, platformId, kind, refreshSequence] as const,
};

export function useMaasConnections() {
  return useQuery({
    queryKey: maasQueryKeys.connections,
    queryFn: () => rpc.maas.listConnections(),
    staleTime: 30_000,
  });
}

export function useConnectMaasPlatform() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: MaasConnectInput) => {
      const result = await rpc.maas.connectPlatform(input);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to connect MaaS platform.');
      }
      return result.connection;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: maasQueryKeys.connections });
      void queryClient.invalidateQueries({ queryKey: ['maas', 'records'] });
    },
  });
}

export function useDisconnectMaasPlatform() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (platformId: MaasPlatformId) => {
      const result = await rpc.maas.disconnectPlatform(platformId);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to disconnect MaaS platform.');
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: maasQueryKeys.connections });
      void queryClient.invalidateQueries({ queryKey: ['maas', 'records'] });
    },
  });
}

export function useMaasInvocationRecords(
  platformId: MaasPlatformId,
  kind: MaasInvocationFilterKind,
  enabled: boolean
) {
  const [refreshSequence, setRefreshSequence] = useState(0);
  const reload = useCallback(() => setRefreshSequence((value) => value + 1), []);

  const query = useInfiniteQuery({
    queryKey: maasQueryKeys.records(platformId, kind, refreshSequence),
    queryFn: async ({ pageParam }: { pageParam: number }) => {
      const page = await rpc.maas.listInvocationRecords({
        platformId,
        kind,
        offset: pageParam,
        limit: PAGE_SIZE,
        forceRefresh: refreshSequence > 0 && pageParam === 0,
      });

      if (page.source !== 'zenmux-management-statistics') {
        throw new Error(
          'MaaS usage data did not come from the ZenMux Management Statistics API. Restart the app to drop the old placeholder data source.'
        );
      }

      return page;
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage) => lastPage.nextOffset ?? undefined,
    enabled,
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: 'always',
  });

  return {
    records: query.data?.pages.flatMap((page) => page.records) ?? [],
    total: query.data?.pages[0]?.total ?? 0,
    source: query.data?.pages[0]?.source ?? null,
    period: query.data?.pages[0]?.period ?? null,
    loading: query.isLoading,
    reloading: query.isFetching && !query.isLoading && !query.isFetchingNextPage,
    isFetchingNextPage: query.isFetchingNextPage,
    hasNextPage: query.hasNextPage,
    fetchNextPage: query.fetchNextPage,
    reload,
    error: query.error
      ? query.error instanceof Error
        ? query.error.message
        : String(query.error)
      : null,
  };
}
