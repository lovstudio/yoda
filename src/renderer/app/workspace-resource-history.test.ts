import { describe, expect, it } from 'vitest';
import type { AppResourceSnapshot } from '@shared/app-resource';
import {
  appendWorkspaceResourceSnapshot,
  createWorkspaceResourceHistoryStore,
  getWorkspaceLatencyP95,
  mergeWorkspaceResourceHistories,
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

  it('keeps samples when every UI subscriber is unmounted', () => {
    const store = createWorkspaceResourceHistoryStore();
    let notificationCount = 0;
    const unsubscribe = store.subscribe(() => {
      notificationCount += 1;
    });

    store.append(snapshotAt(0));
    unsubscribe();
    store.append(snapshotAt(5));

    expect(notificationCount).toBe(1);
    expect(store.getSnapshot().map((point) => point.sampledAt)).toEqual([
      snapshotAt(0).sampledAt,
      snapshotAt(5).sampledAt,
    ]);
  });

  it('merges modal seed history with the shared history without duplicate samples', () => {
    const initial = Array.from({ length: 7 }, (_, index) => snapshotAt(index * 5));
    const shared = Array.from({ length: 9 }, (_, index) => snapshotAt(30 + index * 5));
    const merged = mergeWorkspaceResourceHistories(initial, shared);

    expect(merged).toHaveLength(WORKSPACE_RESOURCE_HISTORY_MAX_POINTS);
    expect(new Set(merged.map((point) => point.sampledAt)).size).toBe(merged.length);
    expect(merged[0]?.sampledAt).toBe(snapshotAt(10).sampledAt);
    expect(merged.at(-1)?.sampledAt).toBe(snapshotAt(70).sampledAt);
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

  it('retains latency series for the resource detail dialog', () => {
    const history = appendWorkspaceResourceSnapshot([], {
      ...snapshotAt(5),
      mainEventLoop: { p50Ms: 1, p95Ms: 3, p99Ms: 5, maxMs: 8 },
      rendererPerformance: {
        sampledAt: new Date().toISOString(),
        eventLoop: { p50Ms: 2, p95Ms: 6, p99Ms: 9, maxMs: 12 },
        inputLatency: { p50Ms: 3, p95Ms: 11, p99Ms: 16, maxMs: 21 },
        longTaskCount: 1,
      },
    });

    expect(history[0]).toMatchObject({
      inputLatencyP95Ms: 11,
      rendererLatencyP95Ms: 6,
      mainLatencyP95Ms: 3,
    });
  });
});
