import { describe, expect, it, vi } from 'vitest';
import { aggregateProcessTree, TtlSingleFlightSampler } from './agent-process-sampler';

describe('aggregateProcessTree', () => {
  it('aggregates descendants and reports the largest process as the representative pid', () => {
    expect(
      aggregateProcessTree(
        [
          { pid: 10, parentPid: 1, cpuPercent: 1, memoryBytes: 10 },
          { pid: 11, parentPid: 10, cpuPercent: 2.5, memoryBytes: 40 },
          { pid: 12, parentPid: 11, cpuPercent: 3, memoryBytes: 20 },
          { pid: 20, parentPid: 1, cpuPercent: 99, memoryBytes: 999 },
        ],
        10
      )
    ).toEqual({ pid: 11, cpuPercent: 6.5, memoryBytes: 70 });
  });
});

describe('TtlSingleFlightSampler', () => {
  it('runs an expensive sample and its histogram reset once for concurrent and TTL hits', async () => {
    let now = 1_000;
    let resolveSample: ((value: { sequence: number }) => void) | undefined;
    const readAndResetHistogram = vi.fn(() => ({ p95Ms: 4 }));
    const load = vi.fn(() => {
      readAndResetHistogram();
      return new Promise<{ sequence: number }>((resolve) => {
        resolveSample = resolve;
      });
    });
    const sampler = new TtlSingleFlightSampler(4_000, () => now);

    const first = sampler.sample(load);
    const second = sampler.sample(load);
    await Promise.resolve();
    expect(load).toHaveBeenCalledOnce();
    expect(readAndResetHistogram).toHaveBeenCalledOnce();

    resolveSample?.({ sequence: 1 });
    await expect(Promise.all([first, second])).resolves.toEqual([{ sequence: 1 }, { sequence: 1 }]);

    now = 4_999;
    await expect(sampler.sample(load)).resolves.toEqual({ sequence: 1 });
    expect(load).toHaveBeenCalledOnce();
    expect(readAndResetHistogram).toHaveBeenCalledOnce();

    now = 5_000;
    const refreshedLoad = vi.fn(async () => {
      readAndResetHistogram();
      return { sequence: 2 };
    });
    const refreshed = sampler.sample(refreshedLoad);
    await expect(refreshed).resolves.toEqual({ sequence: 2 });
    expect(refreshedLoad).toHaveBeenCalledOnce();
    expect(readAndResetHistogram).toHaveBeenCalledTimes(2);
  });

  it('does not cache failures and clear prevents an in-flight sample from repopulating cache', async () => {
    let resolveSample: ((value: number) => void) | undefined;
    const sampler = new TtlSingleFlightSampler(4_000, () => 0);

    await expect(
      sampler.sample(async () => Promise.reject(new Error('sample failed')))
    ).rejects.toThrow('sample failed');
    await expect(sampler.sample(async () => 1)).resolves.toBe(1);

    sampler.clear();
    const pending = sampler.sample(
      () =>
        new Promise<number>((resolve) => {
          resolveSample = resolve;
        })
    );
    await Promise.resolve();
    sampler.clear();
    resolveSample?.(2);
    await expect(pending).resolves.toBe(2);
    await expect(sampler.sample(async () => 3)).resolves.toBe(3);
  });
});
