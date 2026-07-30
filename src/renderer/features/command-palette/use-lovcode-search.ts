import { useQuery } from '@tanstack/react-query';
import type { LovcodeSearchResult } from '@shared/lovcode';
import { rpc } from '@renderer/lib/ipc';

export function useLovcodeSearch(
  query: string,
  enabled: boolean
): { data: LovcodeSearchResult | undefined; isFetching: boolean } {
  const trimmed = query.trim();
  const active = enabled && trimmed.length > 0;

  const { data, isFetching } = useQuery<LovcodeSearchResult>({
    queryKey: ['lovcode-search', trimmed],
    queryFn: () => rpc.lovcode.search(trimmed),
    enabled: active,
    staleTime: 30_000,
  });

  return { data, isFetching };
}
