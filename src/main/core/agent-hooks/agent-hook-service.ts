import { agentEventChannel } from '@shared/events/agentEvents';
import { interactiveTurnLogger } from '@main/core/ai-logs/interactive-turn-logger';
import { agentSessionRuntimeStore } from '@main/core/conversations/agent-session-runtime';
import { events } from '@main/lib/events';
import type { IDisposable, IInitializable } from '@main/lib/lifecycle';
import { enrichEvent } from './event-enricher';
import { HookServer } from './hook-server';
import { enrichHookExecEvent } from './inspect/hook-exec-enricher';
import { isAppFocused, maybeShowNotification } from './notification';

class AgentHookService implements IInitializable, IDisposable {
  private server = new HookServer();

  async initialize(): Promise<void> {
    await this.server.start(async (raw) => {
      if (raw.type === 'hook-exec') {
        await enrichHookExecEvent(raw);
        return;
      }
      const event = await enrichEvent(raw);
      if (!event) return;
      event.source = 'hook';
      agentSessionRuntimeStore.setFromAgentEvent(event);
      await interactiveTurnLogger.onAgentEvent(event);
      const appFocused = isAppFocused();
      await maybeShowNotification(event, appFocused);
      events.emit(agentEventChannel, { event, appFocused });
    });
  }

  dispose(): void {
    this.server.stop();
  }
  getPort(): number {
    return this.server.getPort();
  }
  getToken(): string {
    return this.server.getToken();
  }
}

export const agentHookService = new AgentHookService();
