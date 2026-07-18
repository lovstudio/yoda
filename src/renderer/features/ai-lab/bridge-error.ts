const REMOTE_METHOD_ERROR_PREFIX = /^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/i;

export function normalizeAiLabBridgeError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const normalized = raw.replace(REMOTE_METHOD_ERROR_PREFIX, '').trim();
  return normalized || 'Image generation failed.';
}
