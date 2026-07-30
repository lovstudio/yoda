import { describe, expect, it } from 'vitest';
import { summarizeLatency } from './performance-metrics';

describe('summarizeLatency', () => {
  it('reports stable latency percentiles', () => {
    expect(summarizeLatency([1, 2, 3, 4, 100])).toEqual({
      p50Ms: 3,
      p95Ms: 100,
      p99Ms: 100,
      maxMs: 100,
    });
  });

  it('returns zero metrics without samples', () => {
    expect(summarizeLatency([])).toEqual({ p50Ms: 0, p95Ms: 0, p99Ms: 0, maxMs: 0 });
  });
});
