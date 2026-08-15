import { sessionOpenPerformanceChannel } from '@shared/session-open-performance';
import { events } from '@renderer/lib/ipc';
import { recordTaskOpenTrajectoryStep } from './task-open-trajectory';

/** Mirror main-process cold-session stages into the renderer DevTools timeline. */
export function wireSessionOpenPerformanceBridge(): () => void {
  return events.on(sessionOpenPerformanceChannel, (entry) => {
    // `sinceClickMs` is measured against the same click the renderer trace
    // started from, so both processes land on one timeline without a clock
    // conversion.
    recordTaskOpenTrajectoryStep(entry.context_id, {
      stage: entry.stage,
      source: 'main',
      atMs: entry.sinceClickMs,
    });
    console.log(`[DEBUG][task-open-main] ${entry.stage}:`, entry);
  });
}
