import type { RendererPerformanceSample } from '@shared/app-resource';
import { rpc } from '@renderer/lib/ipc';
import { summarizeLatency } from './performance-metrics';

const SAMPLE_INTERVAL_MS = 100;
const REPORT_INTERVAL_MS = 5_000;

export function startRendererPerformanceReporter(): () => void {
  let loopSamples: number[] = [];
  let inputSamples: number[] = [];
  let longTaskCount = 0;
  let expectedAt = performance.now() + SAMPLE_INTERVAL_MS;

  const loopTimer = window.setInterval(() => {
    const now = performance.now();
    loopSamples.push(Math.max(0, now - expectedAt));
    expectedAt = now + SAMPLE_INTERVAL_MS;
  }, SAMPLE_INTERVAL_MS);

  const observers: PerformanceObserver[] = [];
  if (PerformanceObserver.supportedEntryTypes.includes('event')) {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.name === 'keydown' || entry.name === 'beforeinput' || entry.name === 'input') {
          inputSamples.push(entry.duration);
        }
      }
    });
    observer.observe({
      type: 'event',
      buffered: true,
      durationThreshold: 8,
    } as PerformanceObserverInit & { durationThreshold: number });
    observers.push(observer);
  }
  if (PerformanceObserver.supportedEntryTypes.includes('longtask')) {
    const observer = new PerformanceObserver((list) => {
      longTaskCount += list.getEntries().length;
    });
    observer.observe({ type: 'longtask', buffered: true });
    observers.push(observer);
  }

  const reportTimer = window.setInterval(() => {
    const sample: RendererPerformanceSample = {
      sampledAt: new Date().toISOString(),
      eventLoop: summarizeLatency(loopSamples),
      inputLatency: summarizeLatency(inputSamples),
      longTaskCount,
    };
    loopSamples = [];
    inputSamples = [];
    longTaskCount = 0;
    void rpc.app.reportRendererPerformance(sample).catch(() => {});
  }, REPORT_INTERVAL_MS);

  return () => {
    window.clearInterval(loopTimer);
    window.clearInterval(reportTimer);
    for (const observer of observers) observer.disconnect();
  };
}
