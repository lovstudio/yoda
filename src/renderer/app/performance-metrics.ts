import type { AppEventLoopMetrics } from '@shared/app-resource';

export function summarizeLatency(values: number[]): AppEventLoopMetrics {
  if (values.length === 0) return { p50Ms: 0, p95Ms: 0, p99Ms: 0, maxMs: 0 };
  const sorted = [...values].sort((left, right) => left - right);
  const percentile = (ratio: number): number =>
    sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)];
  const round = (value: number): number => Math.round(value * 10) / 10;
  return {
    p50Ms: round(percentile(0.5)),
    p95Ms: round(percentile(0.95)),
    p99Ms: round(percentile(0.99)),
    maxMs: round(sorted[sorted.length - 1]),
  };
}
