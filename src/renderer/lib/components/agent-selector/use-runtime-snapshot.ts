import { useQuery } from '@tanstack/react-query';
import type { RuntimeId } from '@shared/runtime-registry';
import type { RuntimeSnapshot } from '@shared/runtime-snapshot';
import { rpc } from '@renderer/lib/ipc';

export function runtimeSnapshotQueryKey(runtimeId: RuntimeId, connectionId?: string) {
  return ['runtimeSnapshot', runtimeId, connectionId ?? 'local'] as const;
}

export function useRuntimeSnapshot(runtimeId: RuntimeId, connectionId?: string) {
  return useQuery<RuntimeSnapshot>({
    queryKey: runtimeSnapshotQueryKey(runtimeId, connectionId),
    queryFn: () =>
      rpc.runtimeSettings.getRuntimeSnapshot(runtimeId, {
        connectionId,
      }) as Promise<RuntimeSnapshot>,
    staleTime: 30_000,
  });
}
