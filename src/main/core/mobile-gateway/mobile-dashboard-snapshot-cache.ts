import { TtlSingleFlightSampler } from '@main/core/app/agent-process-sampler';

export const MOBILE_DASHBOARD_SNAPSHOT_TTL_MS = 2_000;

/**
 * Coalesces overlapping dashboard polls and briefly reuses the completed build.
 * TtlSingleFlightSampler starts its TTL after completion and never caches failures.
 */
export class MobileDashboardSnapshotCache<T> {
  private readonly sampler: TtlSingleFlightSampler<T>;

  constructor(now: () => number = Date.now) {
    this.sampler = new TtlSingleFlightSampler(MOBILE_DASHBOARD_SNAPSHOT_TTL_MS, now);
  }

  get(load: () => Promise<T>): Promise<T> {
    return this.sampler.sample(load);
  }

  clear(): void {
    this.sampler.clear();
  }
}
