import { rpcErrorMessage } from '@renderer/lib/rpc-error';

export function normalizeAiLabBridgeError(error: unknown): string {
  return rpcErrorMessage(error) || 'Image generation failed.';
}
