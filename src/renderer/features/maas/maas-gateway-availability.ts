import type { YodaMarketplaceExtension } from '@shared/extensions';

export type MaasGatewayAvailability =
  | 'loading'
  | 'unavailable'
  | 'unsupported'
  | 'not-installed'
  | 'disabled'
  | 'unhealthy'
  | 'ready';

export function resolveMaasGatewayAvailability(
  extension: YodaMarketplaceExtension | undefined
): Exclude<MaasGatewayAvailability, 'loading'> {
  if (!extension) return 'unavailable';
  if (!extension.supported) return 'unsupported';
  if (!extension.installation) return 'not-installed';
  if (!extension.installation.enabled) return 'disabled';
  if (extension.runtime?.state !== 'running') return 'unhealthy';
  return 'ready';
}
