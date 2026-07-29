import { describe, expect, it } from 'vitest';
import type { AppResourceSnapshot } from '@shared/app-resource';
import {
  appendWorkspaceResourceSnapshot,
  getWorkspaceLatencyP95,
  WORKSPACE_RESOURCE_HISTORY_MAX_POINTS,
} from './workspace-resource-history';

function snapshotAt(
  seconds: number
): Pick<AppResourceSnapshot, 'sampledAt' | 'cpuPercent' | 'memoryBytes'> {
  return {
    sampledAt: new Date(Date.UTC(2026, 0, 1, 0, 0, seconds)).toISOString(),
    cpuPercent: seconds,
    memoryBytes: seconds * 1024,
  };
}

describe('workspace resource history', () => {
  it('keeps a deduplicated rolling minute of samples', () => {
    let history = [snapshotAt(0)];
    for (let second = 5; second <= 70; second += 5) {
      history = appendWorkspaceResourceSnapshot(history, snapshotAt(second));
    }

    expect(history).toHaveLength(WORKSPACE_RESOURCE_HISTORY_MAX_POINTS);
    expect(history[0]?.sampledAt).toBe(snapshotAt(10).sampledAt);
    expect(history.at(-1)?.sampledAt).toBe(snapshotAt(70).sampledAt);
    expect(appendWorkspaceResourceSnapshot(history, snapshotAt(70))).toBe(history);
  });

  it('uses the slower user-facing renderer signal for the compact latency metric', () => {
    expect(
      getWorkspaceLatencyP95({
        rendererPerformance: {
          sampledAt: new Date().toISOString(),
          eventLoop: { p50Ms: 1, p95Ms: 4.2, p99Ms: 8, maxMs: 12 },
          inputLatency: { p50Ms: 2, p95Ms: 9.5, p99Ms: 14, maxMs: 20 },
          longTaskCount: 0,
        },
      })
    ).toBe(9.5);
    expect(getWorkspaceLatencyP95(undefined)).toBeNull();
  });
});
