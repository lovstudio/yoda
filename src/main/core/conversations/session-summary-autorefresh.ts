import { agentSessionStatusChangedChannel } from '@shared/events/agentEvents';
import { events } from '@main/lib/events';
import { log } from '@main/lib/logger';
import { refreshConversationSummary } from './session-summary-context';

const REFRESH_DELAY_MS = 1_200;

type RefreshKey = {
  projectId: string;
  taskId: string;
  conversationId: string;
};

function keyFor(key: RefreshKey): string {
  return `${key.projectId}\0${key.taskId}\0${key.conversationId}`;
}

class SessionSummaryAutoRefreshService {
  private offStatusChanged: (() => void) | null = null;
  private timers = new Map<string, NodeJS.Timeout>();

  initialize(): void {
    if (this.offStatusChanged) return;
    this.offStatusChanged = events.on(agentSessionStatusChangedChannel, (event) => {
      if (event.status !== 'completed') return;
      this.schedule({
        projectId: event.projectId,
        taskId: event.taskId,
        conversationId: event.conversationId,
      });
    });
  }

  dispose(): void {
    this.offStatusChanged?.();
    this.offStatusChanged = null;
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }

  private schedule(key: RefreshKey): void {
    const id = keyFor(key);
    const current = this.timers.get(id);
    if (current) clearTimeout(current);

    const timer = setTimeout(() => {
      this.timers.delete(id);
      void refreshConversationSummary(key, 'global').catch((error: unknown) => {
        log.warn('session-summary auto-refresh failed', {
          conversationId: key.conversationId,
          error: String(error),
        });
      });
    }, REFRESH_DELAY_MS);
    timer.unref?.();
    this.timers.set(id, timer);
  }
}

export const sessionSummaryAutoRefreshService = new SessionSummaryAutoRefreshService();
