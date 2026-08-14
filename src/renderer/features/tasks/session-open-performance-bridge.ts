import { sessionOpenPerformanceChannel } from '@shared/session-open-performance';
import { events } from '@renderer/lib/ipc';

/** Mirror main-process cold-session stages into the renderer DevTools timeline. */
export function wireSessionOpenPerformanceBridge(): () => void {
  return events.on(sessionOpenPerformanceChannel, (entry) => {
    console.log(`[DEBUG][task-open-main] ${entry.stage}:`, entry);
  });
}
