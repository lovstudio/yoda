import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  AdaptiveProcessTreeSampler,
  AGENT_PROCESS_HIDDEN_MAX_AGE_MS,
  AGENT_PROCESS_VISIBLE_MAX_AGE_MS,
  aggregateProcessTree,
  aggregateProcessTrees,
  getAgentProcessSampleMaxAge,
  TtlSingleFlightSampler,
} from './agent-process-sampler';

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

  it('aggregates several independent roots from the same process index', () => {
    const rows = [
      { pid: 10, parentPid: 1, cpuPercent: 1, memoryBytes: 10 },
      { pid: 11, parentPid: 10, cpuPercent: 2, memoryBytes: 40 },
      { pid: 20, parentPid: 1, cpuPercent: 3, memoryBytes: 30 },
      { pid: 21, parentPid: 20, cpuPercent: 4, memoryBytes: 20 },
    ];

    expect(aggregateProcessTrees(rows, [10, 20])).toEqual(
      new Map([
        [10, { pid: 11, cpuPercent: 3, memoryBytes: 50 }],
        [20, { pid: 20, cpuPercent: 7, memoryBytes: 50 }],
      ])
    );
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

  it('lets a caller demand a fresher result than the default TTL', async () => {
    let now = 0;
    const sampler = new TtlSingleFlightSampler(60_000, () => now);
    const load = vi.fn(async () => now);

    await expect(sampler.sample(load)).resolves.toBe(0);
    now = 5_000;
    await expect(sampler.sample(load, 4_000)).resolves.toBe(5_000);

    expect(load).toHaveBeenCalledTimes(2);
  });
});

describe('AdaptiveProcessTreeSampler', () => {
  function resource(pid: number) {
    return { pid, cpuPercent: pid / 10, memoryBytes: pid * 1_024 };
  }

  it('reuses a system-wide sample throughout the hidden-panel max age', async () => {
    let now = 0;
    const load = vi.fn(
      async (rootPids: number[]) => new Map(rootPids.map((pid) => [pid, resource(pid)]))
    );
    const sampler = new AdaptiveProcessTreeSampler(load, () => now);

    await sampler.sample([20, 10, 20], AGENT_PROCESS_HIDDEN_MAX_AGE_MS);
    for (now = 10_000; now < AGENT_PROCESS_HIDDEN_MAX_AGE_MS; now += 10_000) {
      await sampler.sample([10, 20], AGENT_PROCESS_HIDDEN_MAX_AGE_MS);
    }
    expect(load).toHaveBeenCalledOnce();
    expect(load).toHaveBeenCalledWith([10, 20]);

    now = AGENT_PROCESS_HIDDEN_MAX_AGE_MS;
    await sampler.sample([10, 20], AGENT_PROCESS_HIDDEN_MAX_AGE_MS);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('refreshes for a visible panel and immediately discovers new root PIDs', async () => {
    let now = 0;
    const load = vi.fn(
      async (rootPids: number[]) => new Map(rootPids.map((pid) => [pid, resource(pid)]))
    );
    const sampler = new AdaptiveProcessTreeSampler(load, () => now);

    await sampler.sample([10, 20], AGENT_PROCESS_HIDDEN_MAX_AGE_MS);
    now = AGENT_PROCESS_VISIBLE_MAX_AGE_MS + 1;
    await sampler.sample([10, 20], AGENT_PROCESS_VISIBLE_MAX_AGE_MS);
    expect(load).toHaveBeenCalledTimes(2);

    now += 1;
    await sampler.sample([10, 20, 30], AGENT_PROCESS_HIDDEN_MAX_AGE_MS);
    expect(load).toHaveBeenCalledTimes(3);

    await expect(sampler.sample([20], AGENT_PROCESS_HIDDEN_MAX_AGE_MS)).resolves.toEqual(
      new Map([[20, resource(20)]])
    );
    expect(load).toHaveBeenCalledTimes(3);
  });

  it('coalesces concurrent requests that can share the same process inventory', async () => {
    let resolveLoad: ((value: Map<number, ReturnType<typeof resource>>) => void) | undefined;
    const load = vi.fn(
      () =>
        new Promise<Map<number, ReturnType<typeof resource>>>((resolve) => {
          resolveLoad = resolve;
        })
    );
    const sampler = new AdaptiveProcessTreeSampler(load, () => 0);

    const full = sampler.sample([10, 20], AGENT_PROCESS_VISIBLE_MAX_AGE_MS);
    const subset = sampler.sample([10], AGENT_PROCESS_VISIBLE_MAX_AGE_MS);
    await Promise.resolve();
    expect(load).toHaveBeenCalledOnce();
    resolveLoad?.(
      new Map([
        [10, resource(10)],
        [20, resource(20)],
      ])
    );

    await expect(full).resolves.toHaveLength(2);
    await expect(subset).resolves.toEqual(new Map([[10, resource(10)]]));
  });

  it('exposes the visible and hidden sampling policy explicitly', () => {
    expect(getAgentProcessSampleMaxAge(true)).toBe(4_000);
    expect(getAgentProcessSampleMaxAge(false)).toBe(5 * 60_000);
  });
});

describe('AppService process sampling wiring', () => {
  it('routes every full process inventory through the adaptive cache', () => {
    const serviceSource = readFileSync(new URL('./service.ts', import.meta.url), 'utf8');

    expect(serviceSource).toContain(
      'private readonly agentProcessSampler = new AdaptiveProcessTreeSampler()'
    );
    expect(serviceSource).toContain('await this.agentProcessSampler.sample(');
    expect(serviceSource).toContain('getAgentProcessSampleMaxAge(freshAgentProcesses)');
    expect(serviceSource).not.toContain('await sampleProcessTrees(');
  });
});
