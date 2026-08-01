import { readFileSync } from 'node:fs';
import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import type { AppResourceSnapshot } from '@shared/app-resource';
import {
  getWorkspaceResourcePollInterval,
  WORKSPACE_RESOURCE_ACTIVE_POLL_INTERVAL_MS,
  WORKSPACE_RESOURCE_DETAILS_QUERY_TIMING,
  WORKSPACE_RESOURCE_IDLE_POLL_INTERVAL_MS,
  WORKSPACE_RESOURCE_POLL_INTERVAL_MS,
  WORKSPACE_RESOURCE_QUERY_KEY,
  WORKSPACE_RESOURCE_QUERY_TIMING,
} from './workspace-resource-monitoring';

describe('workspace resource monitoring', () => {
  it('pauses sampling while the Yoda window is in the background', () => {
    expect(WORKSPACE_RESOURCE_QUERY_TIMING).toMatchObject({
      refetchIntervalInBackground: false,
      refetchOnWindowFocus: true,
    });
    expect(WORKSPACE_RESOURCE_POLL_INTERVAL_MS).toBe(WORKSPACE_RESOURCE_ACTIVE_POLL_INTERVAL_MS);
  });

  it('samples quickly only while an agent is actively running', () => {
    expect(
      getWorkspaceResourcePollInterval({
        agentSessions: [{ status: 'working' }, { status: 'idle' }],
      })
    ).toBe(WORKSPACE_RESOURCE_ACTIVE_POLL_INTERVAL_MS);
    expect(
      getWorkspaceResourcePollInterval({
        agentSessions: [{ status: 'awaiting-input' }],
      })
    ).toBe(WORKSPACE_RESOURCE_ACTIVE_POLL_INTERVAL_MS);
    expect(
      getWorkspaceResourcePollInterval({
        agentSessions: [{ status: 'idle' }, { status: 'completed' }],
      })
    ).toBe(WORKSPACE_RESOURCE_IDLE_POLL_INTERVAL_MS);
    expect(getWorkspaceResourcePollInterval(undefined)).toBe(
      WORKSPACE_RESOURCE_IDLE_POLL_INTERVAL_MS
    );
  });

  it('keeps the detail observer passive so it cannot start a second polling timer', () => {
    expect(WORKSPACE_RESOURCE_DETAILS_QUERY_TIMING).toMatchObject({
      enabled: false,
      refetchInterval: false,
      refetchIntervalInBackground: false,
    });
  });

  it('uses one AppResourceSnapshot query key in the runtime bar and detail observer', () => {
    const runtimeBarSource = readFileSync(
      new URL('./workspace-runtime-bar.tsx', import.meta.url),
      'utf8'
    );
    const detailsSource = readFileSync(
      new URL('./workspace-resource-details-modal.tsx', import.meta.url),
      'utf8'
    );

    expect(WORKSPACE_RESOURCE_QUERY_KEY).toEqual(['app', 'resourceSnapshot']);
    expect(runtimeBarSource).toContain('queryKey: WORKSPACE_RESOURCE_QUERY_KEY');
    expect(detailsSource).toContain('queryKey: WORKSPACE_RESOURCE_QUERY_KEY');
    expect(detailsSource).not.toContain("['app', 'resourceDetails']");
  });

  it('delivers shared cache updates to the passive detail observer', () => {
    const queryClient = new QueryClient();
    const observer = new QueryObserver<AppResourceSnapshot>(queryClient, {
      queryKey: WORKSPACE_RESOURCE_QUERY_KEY,
      enabled: false,
    });
    const snapshot: AppResourceSnapshot = {
      sampledAt: '2026-08-01T00:00:00.000Z',
      cpuPercent: 1,
      memoryBytes: 2,
      agentSessions: [],
      processes: [],
      mainEventLoop: { p50Ms: 0, p95Ms: 0, p99Ms: 0, maxMs: 0 },
      rendererPerformance: null,
    };
    const unsubscribe = observer.subscribe(() => {});

    queryClient.setQueryData(WORKSPACE_RESOURCE_QUERY_KEY, snapshot);

    expect(observer.getCurrentResult().data).toBe(snapshot);
    unsubscribe();
    queryClient.clear();
  });
});
