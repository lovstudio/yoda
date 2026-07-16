import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import type {
  MaasConnectInput,
  MaasGlobalBindingStatus,
  MaasInvocationFilterKind,
  MaasPlatformId,
  MaasPlatformOfficialDescription,
  MaasRuntimeBindingStatus,
  MaasSetGlobalBindingInput,
  MaasSetRuntimeBindingInput,
  MaasUsageSummary,
} from '@shared/maas';
import { rpc } from '@renderer/lib/ipc';

const PAGE_SIZE = 24;
const REAL_USAGE_QUERY_VERSION = 'zenmux-management-statistics-v2';
const PLATFORM_DESCRIPTION_QUERY_VERSION = 'official-page-description-v1';

export const maasQueryKeys = {
  connections: ['maas', 'connections'] as const,
  platformDescriptions: [
    'maas',
    'platform-descriptions',
    PLATFORM_DESCRIPTION_QUERY_VERSION,
  ] as const,
  runtimeBindings: (platformId?: MaasPlatformId) =>
    ['maas', 'runtime-bindings', platformId ?? 'all'] as const,
  globalBinding: ['maas', 'global-binding'] as const,
  records: (platformId: MaasPlatformId, kind: MaasInvocationFilterKind, refreshSequence = 0) =>
    ['maas', 'records', REAL_USAGE_QUERY_VERSION, platformId, kind, refreshSequence] as const,
  summary: (
    platformId: MaasPlatformId,
    kind: MaasInvocationFilterKind,
    providerHints: readonly string[],
    modelHints: readonly string[],
    refreshSequence = 0
  ) =>
    [
      'maas',
      'summary',
      REAL_USAGE_QUERY_VERSION,
      platformId,
      kind,
      providerHints.join('|'),
      modelHints.join('|'),
      refreshSequence,
    ] as const,
};

export function useMaasRuntimeBindings(platformId?: MaasPlatformId, enabled = true) {
  return useQuery<MaasRuntimeBindingStatus[]>({
    queryKey: maasQueryKeys.runtimeBindings(platformId),
    queryFn: () => rpc.maas.listRuntimeBindings(),
    enabled,
    staleTime: 5_000,
  });
}

export function useSetMaasRuntimeBinding() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: MaasSetRuntimeBindingInput) => {
      const result = await rpc.maas.setRuntimeBinding(input);
      if (!result.success) throw new Error(result.error ?? 'Failed to update MaaS Client.');
    },
    onSuccess: (_result, input) => {
      void queryClient.invalidateQueries({ queryKey: ['maas', 'runtime-bindings'] });
      void queryClient.invalidateQueries({
        queryKey: ['runtimeSettings', input.runtimeId, 'meta'],
      });
      void queryClient.invalidateQueries({ queryKey: ['runtimeSettings', 'all'] });
      void queryClient.invalidateQueries({ queryKey: ['runtimeSnapshot', input.runtimeId] });
    },
  });
}

export function useMaasGlobalBinding(enabled = true) {
  return useQuery<MaasGlobalBindingStatus>({
    queryKey: maasQueryKeys.globalBinding,
    queryFn: () => rpc.maas.getGlobalBinding(),
    enabled,
    staleTime: 5_000,
  });
}

export function useSetMaasGlobalBinding() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: MaasSetGlobalBindingInput) => {
      const result = await rpc.maas.setGlobalBinding(input);
      if (!result.success) throw new Error(result.error ?? 'Failed to update MaaS.');
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: maasQueryKeys.globalBinding });
      void queryClient.invalidateQueries({ queryKey: ['maas', 'runtime-bindings'] });
      void queryClient.invalidateQueries({ queryKey: ['runtimeSettings'] });
      void queryClient.invalidateQueries({ queryKey: ['runtimeSnapshot'] });
    },
  });
}

export function useMaasConnections(enabled = true) {
  return useQuery({
    queryKey: maasQueryKeys.connections,
    queryFn: () => rpc.maas.listConnections(),
    enabled,
    staleTime: 30_000,
  });
}

export function useMaasPlatformDescriptions(enabled = true) {
  return useQuery<MaasPlatformOfficialDescription[]>({
    queryKey: maasQueryKeys.platformDescriptions,
    queryFn: () => rpc.maas.listPlatformDescriptions(),
    enabled,
    staleTime: 24 * 60 * 60 * 1_000,
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

export function useCheckMaasConnection() {
  return useMutation({
    mutationFn: (platformId: MaasPlatformId) => rpc.maas.checkConnection(platformId),
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

export function useMaasUsageSummary(
  platformId: MaasPlatformId,
  kind: MaasInvocationFilterKind,
  enabled: boolean,
  filters?: {
    providerHints?: readonly string[];
    modelHints?: readonly string[];
  }
) {
  const [refreshSequence, setRefreshSequence] = useState(0);
  const reload = useCallback(() => setRefreshSequence((value) => value + 1), []);
  const providerHints = filters?.providerHints ?? [];
  const modelHints = filters?.modelHints ?? [];

  const query = useQuery<MaasUsageSummary>({
    queryKey: maasQueryKeys.summary(platformId, kind, providerHints, modelHints, refreshSequence),
    queryFn: () =>
      rpc.maas.getUsageSummary({
        platformId,
        kind,
        providerHints,
        modelHints,
        forceRefresh: refreshSequence > 0,
      }) as Promise<MaasUsageSummary>,
    enabled,
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: 'always',
  });

  return {
    summary: query.data ?? null,
    loading: query.isLoading,
    reloading: query.isFetching && !query.isLoading,
    reload,
    error: query.error
      ? query.error instanceof Error
        ? query.error.message
        : String(query.error)
      : null,
  };
}
