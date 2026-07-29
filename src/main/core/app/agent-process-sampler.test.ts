import { describe, expect, it } from 'vitest';
import { aggregateProcessTree } from './agent-process-sampler';

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
