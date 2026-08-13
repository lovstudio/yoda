import type { AppSettings } from '@shared/app-settings';
import { rpc } from '@renderer/lib/ipc';

let cachedSettings: AppSettings['terminal'] | null = null;
type SettingsRequest = {
  id: number;
  promise: Promise<AppSettings['terminal']>;
};

let settingsRequest: SettingsRequest | null = null;
let optimisticPatch: Partial<AppSettings['terminal']> | null = null;
let cacheRevision = 0;
let nextRequestId = 0;

/** Keep this inside the cache so one stuck preload cannot poison every later PTY. */
export const TERMINAL_SETTINGS_REQUEST_TIMEOUT_MS = 3_000;

class TerminalSettingsRequestTimeoutError extends Error {
  constructor() {
    super(`Terminal settings request exceeded ${TERMINAL_SETTINGS_REQUEST_TIMEOUT_MS}ms`);
    this.name = 'TerminalSettingsRequestTimeoutError';
  }
}

function applyOptimisticPatch(settings: AppSettings['terminal']): AppSettings['terminal'] {
  return optimisticPatch ? { ...settings, ...optimisticPatch } : settings;
}

/**
 * Share the terminal settings RPC across every PtySession preparation. A task
 * switch must not spend up to the per-call timeout fetching the same immutable
 * snapshot for each destination xterm.
 */
export function loadTerminalSettings(): Promise<AppSettings['terminal']> {
  if (cachedSettings) return Promise.resolve(cachedSettings);
  if (settingsRequest) return settingsRequest.promise;

  const requestedRevision = cacheRevision;
  const requestId = ++nextRequestId;
  let timeout: ReturnType<typeof setTimeout> | null = null;
  const rawRequest = rpc.appSettings.get('terminal') as Promise<AppSettings['terminal']>;
  const boundedRequest = new Promise<AppSettings['terminal']>((resolve, reject) => {
    timeout = setTimeout(() => {
      // Only the request that still owns the shared slot may release it. A
      // newer request can already exist after invalidation or another timeout.
      if (settingsRequest?.id === requestId) settingsRequest = null;
      reject(new TerminalSettingsRequestTimeoutError());
    }, TERMINAL_SETTINGS_REQUEST_TIMEOUT_MS);
    rawRequest.then(resolve, reject);
  });
  const promise = boundedRequest
    .then(
      (settings) => {
        // A settings mutation or invalidation crossed this RPC. Never return or
        // cache its stale pre-mutation snapshot; join a request for the current
        // revision instead. patchTerminalSettingsCache clears the shared slot,
        // so this cannot recursively join itself.
        if (cacheRevision !== requestedRevision) return loadTerminalSettings();
        const resolved = applyOptimisticPatch(settings);
        cachedSettings = resolved;
        return resolved;
      },
      (error: unknown) => {
        // An obsolete request must not fail a caller after a newer settings
        // revision already exists. Retry against that revision; otherwise keep
        // the real current-revision error visible to PtySession's fallback path.
        if (cacheRevision !== requestedRevision) return loadTerminalSettings();
        throw error;
      }
    )
    .finally(() => {
      if (timeout !== null) clearTimeout(timeout);
      if (settingsRequest?.id === requestId) settingsRequest = null;
    });
  settingsRequest = { id: requestId, promise };
  return promise;
}

export function patchTerminalSettingsCache(partial: Partial<AppSettings['terminal']>): void {
  cacheRevision += 1;
  optimisticPatch = { ...optimisticPatch, ...partial };
  if (cachedSettings) cachedSettings = { ...cachedSettings, ...partial };
  // Let the next load start at the new revision. Callers already awaiting the
  // old request are redirected by its revision guard above.
  settingsRequest = null;
}

export function invalidateTerminalSettingsCache(): void {
  cacheRevision += 1;
  cachedSettings = null;
  optimisticPatch = null;
  settingsRequest = null;
}
