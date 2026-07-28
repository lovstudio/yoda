import { rpc } from '@renderer/lib/ipc';

export const EXTENSION_MARKETPLACE_QUERY_KEY = ['extensions', 'marketplace'] as const;

export function listMarketplaceExtensions() {
  return rpc.extensions.listMarketplace();
}
