import type { AppAgentSessionResource, AppResourceSnapshot } from '@shared/app-resource';
import { isAgentSessionRunningStatus } from '@shared/events/agentEvents';

export const WORKSPACE_RESOURCE_QUERY_KEY = ['app', 'resourceSnapshot'] as const;
export const WORKSPACE_RESOURCE_ACTIVE_POLL_INTERVAL_MS = 30_000;
export const WORKSPACE_RESOURCE_IDLE_POLL_INTERVAL_MS = 60_000;
export const WORKSPACE_RESOURCE_AGENT_PANEL_POLL_INTERVAL_MS = 5_000;
export const WORKSPACE_RESOURCE_AGENT_PANEL_STALE_TIME_MS = 4_000;
export const WORKSPACE_RESOURCE_POLL_INTERVAL_MS = WORKSPACE_RESOURCE_ACTIVE_POLL_INTERVAL_MS;

type WorkspaceResourceQuery = {
  state: {
    data?: AppResourceSnapshot;
  };
};

export function getWorkspaceResourcePollInterval(
  snapshot: { agentSessions: Array<Pick<AppAgentSessionResource, 'status'>> } | undefined
): number {
  return snapshot?.agentSessions.some((session) => isAgentSessionRunningStatus(session.status))
    ? WORKSPACE_RESOURCE_ACTIVE_POLL_INTERVAL_MS
    : WORKSPACE_RESOURCE_IDLE_POLL_INTERVAL_MS;
}

export function getWorkspaceResourceQueryPollInterval(query: WorkspaceResourceQuery): number {
  return getWorkspaceResourcePollInterval(query.state.data);
}

export function getWorkspaceResourceQueryTiming(agentPanelVisible: boolean) {
  return {
    staleTime: agentPanelVisible ? WORKSPACE_RESOURCE_AGENT_PANEL_STALE_TIME_MS : 29_000,
    refetchInterval: agentPanelVisible
      ? WORKSPACE_RESOURCE_AGENT_PANEL_POLL_INTERVAL_MS
      : getWorkspaceResourceQueryPollInterval,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  } as const;
}

export const WORKSPACE_RESOURCE_QUERY_TIMING = getWorkspaceResourceQueryTiming(false);

// The runtime bar owns the single adaptive polling observer. Details observe
// the exact same query without creating a second timer.
export const WORKSPACE_RESOURCE_DETAILS_QUERY_TIMING = {
  enabled: false,
  refetchInterval: false,
  refetchIntervalInBackground: false,
  refetchOnWindowFocus: false,
} as const;
