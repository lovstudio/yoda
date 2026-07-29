import type { AppResourceSnapshot } from '@shared/app-resource';

export const WORKSPACE_RESOURCE_HISTORY_WINDOW_MS = 60_000;
export const WORKSPACE_RESOURCE_HISTORY_MAX_POINTS = 13;

export type WorkspaceResourceHistoryPoint = {
  sampledAt: string;
  cpuPercent: number;
  memoryBytes: number;
  inputLatencyP95Ms?: number | null;
  rendererLatencyP95Ms?: number | null;
  mainLatencyP95Ms?: number | null;
};

export function appendWorkspaceResourceSnapshot(
  history: WorkspaceResourceHistoryPoint[],
  snapshot: Pick<AppResourceSnapshot, 'sampledAt' | 'cpuPercent' | 'memoryBytes'> &
    Partial<Pick<AppResourceSnapshot, 'mainEventLoop' | 'rendererPerformance'>>
): WorkspaceResourceHistoryPoint[] {
  if (history.some((point) => point.sampledAt === snapshot.sampledAt)) return history;

  const nextPoint: WorkspaceResourceHistoryPoint = {
    sampledAt: snapshot.sampledAt,
    cpuPercent: snapshot.cpuPercent,
    memoryBytes: snapshot.memoryBytes,
    inputLatencyP95Ms: snapshot.rendererPerformance?.inputLatency.p95Ms ?? null,
    rendererLatencyP95Ms: snapshot.rendererPerformance?.eventLoop.p95Ms ?? null,
    mainLatencyP95Ms: snapshot.mainEventLoop?.p95Ms ?? null,
  };
  const sorted = [...history, nextPoint].sort(
    (left, right) => Date.parse(left.sampledAt) - Date.parse(right.sampledAt)
  );
  const newestAt = Date.parse(sorted.at(-1)?.sampledAt ?? snapshot.sampledAt);
  const windowStart = newestAt - WORKSPACE_RESOURCE_HISTORY_WINDOW_MS;

  return sorted
    .filter((point) => Date.parse(point.sampledAt) >= windowStart)
    .slice(-WORKSPACE_RESOURCE_HISTORY_MAX_POINTS);
}

export function getWorkspaceLatencyP95(
  snapshot: Pick<AppResourceSnapshot, 'rendererPerformance'> | undefined
): number | null {
  const performance = snapshot?.rendererPerformance;
  if (!performance) return null;

  return Math.max(performance.inputLatency.p95Ms, performance.eventLoop.p95Ms);
}
