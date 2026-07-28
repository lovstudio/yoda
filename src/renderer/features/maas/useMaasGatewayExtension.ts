import { useQuery } from '@tanstack/react-query';
import { MAAS_GATEWAY_EXTENSION_ID } from '@shared/extensions';
import {
  EXTENSION_MARKETPLACE_QUERY_KEY,
  listMarketplaceExtensions,
} from '@renderer/features/extensions/extension-marketplace-query';
import {
  resolveMaasGatewayAvailability,
  type MaasGatewayAvailability,
} from './maas-gateway-availability';

export function useMaasGatewayExtension(): {
  availability: MaasGatewayAvailability;
  ready: boolean;
} {
  const query = useQuery({
    queryKey: EXTENSION_MARKETPLACE_QUERY_KEY,
    queryFn: listMarketplaceExtensions,
    staleTime: 5_000,
    refetchInterval: 5_000,
  });
  const extension = query.data?.find(
    (candidate) => candidate.manifest.id === MAAS_GATEWAY_EXTENSION_ID
  );
  const availability: MaasGatewayAvailability = query.isPending
    ? 'loading'
    : query.isError
      ? 'unavailable'
      : resolveMaasGatewayAvailability(extension);

  return {
    availability,
    ready: availability === 'ready',
  };
}
