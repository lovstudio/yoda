import { net } from 'electron';
import { getNpmPackageForRuntime, type RuntimeId } from '@shared/runtime-registry';
import { TTLCache } from '@main/core/utils/ttl-cache';
import { log } from '@main/lib/logger';

const LATEST_VERSION_CACHE_TTL_MS = 6 * 60 * 60 * 1_000;
const LATEST_VERSION_TIMEOUT_MS = 5_000;

export type RuntimeLatestVersion = {
  latestVersion: string;
  lastCheckedAt: string;
};

/**
 * Reads the version an `npm install -g` would produce. Channel tags (`next`,
 * `nightly`, `alpha`, per-platform tags) are deliberately ignored: the card
 * compares against what the user's install command actually resolves to.
 */
export function parseNpmDistTags(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const latest = (payload as Record<string, unknown>).latest;
  return typeof latest === 'string' && latest.trim() ? latest.trim() : null;
}

const caches = new Map<string, TTLCache<RuntimeLatestVersion>>();

function cacheFor(npmPackage: string): TTLCache<RuntimeLatestVersion> {
  const existing = caches.get(npmPackage);
  if (existing) return existing;
  const cache = new TTLCache<RuntimeLatestVersion>(LATEST_VERSION_CACHE_TTL_MS);
  caches.set(npmPackage, cache);
  return cache;
}

async function fetchNpmLatestVersion(npmPackage: string): Promise<RuntimeLatestVersion> {
  const url = `https://registry.npmjs.org/-/package/${encodeURIComponent(npmPackage)}/dist-tags`;
  const response = await net.fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'Yoda' },
    signal: AbortSignal.timeout(LATEST_VERSION_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`npm registry returned ${response.status} ${response.statusText || ''}`.trim());
  }
  const latestVersion = parseNpmDistTags(await response.json());
  if (!latestVersion) throw new Error('npm registry response did not include a latest dist-tag.');
  return { latestVersion, lastCheckedAt: new Date().toISOString() };
}

/**
 * Latest published version of a runtime's CLI, or null when the runtime is not
 * distributed through npm or the lookup failed. Failures are not cached, so the
 * next card open retries.
 */
export async function getRuntimeLatestVersion(
  runtimeId: RuntimeId
): Promise<RuntimeLatestVersion | null> {
  const npmPackage = getNpmPackageForRuntime(runtimeId);
  if (!npmPackage) return null;
  try {
    return await cacheFor(npmPackage).get(() => fetchNpmLatestVersion(npmPackage));
  } catch (error) {
    log.debug('runtime snapshot: failed to read the latest published version', {
      runtimeId,
      npmPackage,
      error: String(error),
    });
    return null;
  }
}
