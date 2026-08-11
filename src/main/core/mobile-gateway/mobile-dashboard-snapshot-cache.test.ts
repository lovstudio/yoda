import { describe, expect, it, vi } from 'vitest';
import { MobileDashboardSnapshotCache } from './mobile-dashboard-snapshot-cache';

describe('MobileDashboardSnapshotCache', () => {
  it('builds overlapping snapshots once and starts its TTL when the build completes', async () => {
    let now = 1_000;
    let resolveBuild: ((value: { sequence: number }) => void) | undefined;
    const build = vi.fn(
      () =>
        new Promise<{ sequence: number }>((resolve) => {
          resolveBuild = resolve;
        })
    );
    const cache = new MobileDashboardSnapshotCache(() => now);

    const first = cache.get(build);
    const concurrent = cache.get(build);
    await Promise.resolve();
    expect(build).toHaveBeenCalledOnce();

    now = 9_000;
    resolveBuild?.({ sequence: 1 });
    await expect(Promise.all([first, concurrent])).resolves.toEqual([
      { sequence: 1 },
      { sequence: 1 },
    ]);

    now = 10_999;
    await expect(cache.get(build)).resolves.toEqual({ sequence: 1 });
    expect(build).toHaveBeenCalledOnce();

    now = 11_000;
    const refresh = vi.fn(async () => ({ sequence: 2 }));
    await expect(cache.get(refresh)).resolves.toEqual({ sequence: 2 });
    expect(refresh).toHaveBeenCalledOnce();
  });

  it('does not cache a failed snapshot build', async () => {
    const cache = new MobileDashboardSnapshotCache(() => 0);
    const build = vi
      .fn<() => Promise<number>>()
      .mockRejectedValueOnce(new Error('snapshot failed'))
      .mockResolvedValueOnce(2);

    await expect(cache.get(build)).rejects.toThrow('snapshot failed');
    await expect(cache.get(build)).resolves.toBe(2);
    expect(build).toHaveBeenCalledTimes(2);
  });

  it('invalidates a warm snapshot before an immediate post-mutation refresh', async () => {
    const cache = new MobileDashboardSnapshotCache(() => 1_000);
    const initial = vi.fn(async () => ({ tasks: ['old'] }));
    const refreshed = vi.fn(async () => ({ tasks: ['new'] }));

    await expect(cache.get(initial)).resolves.toEqual({ tasks: ['old'] });
    cache.clear();
    await expect(cache.get(refreshed)).resolves.toEqual({ tasks: ['new'] });

    expect(initial).toHaveBeenCalledOnce();
    expect(refreshed).toHaveBeenCalledOnce();
  });
});
