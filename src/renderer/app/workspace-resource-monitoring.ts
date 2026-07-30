export const WORKSPACE_RESOURCE_POLL_INTERVAL_MS = 5_000;

export const WORKSPACE_RESOURCE_QUERY_TIMING = {
  staleTime: 2_000,
  refetchInterval: WORKSPACE_RESOURCE_POLL_INTERVAL_MS,
  refetchIntervalInBackground: true,
  refetchOnWindowFocus: false,
} as const;
