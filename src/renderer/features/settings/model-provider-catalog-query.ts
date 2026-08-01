import { useQuery } from '@tanstack/react-query';
import type { ModelProviderCatalogResult } from '@shared/model-provider-catalog';
import { rpc } from '@renderer/lib/ipc';

export const MODEL_PROVIDERS_QUERY_KEY = ['llm', 'modelProviders'] as const;

export function useModelProviderCatalog() {
  return useQuery<ModelProviderCatalogResult>({
    queryKey: MODEL_PROVIDERS_QUERY_KEY,
    queryFn: () => rpc.llm.listModelProviders(),
    staleTime: 60_000,
  });
}
