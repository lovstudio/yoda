export const HARNESS_CONTEXT_REFRESH_MS = 30_000;

/**
 * Harness discovery scans instruction files, skills, agents, and runtime tools.
 * Keep it fully dormant behind a collapsed/hidden blind, then refresh at a
 * human-scale interval while the user is actually inspecting that section.
 */
export function getHarnessContextQueryTiming(active: boolean) {
  return {
    enabled: active,
    staleTime: HARNESS_CONTEXT_REFRESH_MS - 1_000,
    refetchInterval: active ? HARNESS_CONTEXT_REFRESH_MS : (false as const),
    refetchIntervalInBackground: false,
  };
}
