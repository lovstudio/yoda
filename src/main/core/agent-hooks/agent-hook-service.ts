import { agentEventChannel } from '@shared/events/agentEvents';
import { parsePtyId } from '@shared/ptyId';
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
      if (raw.type === 'team-at') {
        const conversationId = parsePtyId(raw.ptyId)?.conversationId;
        let payload: { to?: unknown; message?: unknown } = {};
        try {
          payload = JSON.parse(raw.body || '{}');
        } catch {
          return;
        }
        const to =
          payload.to === 'all' ? 'all' : Array.isArray(payload.to) ? payload.to.map(String) : [];
        const message = typeof payload.message === 'string' ? payload.message : '';
        if (conversationId && (to === 'all' || to.length > 0)) {
          // Lazy import to avoid an agent-hooks ↔ team-rooms load-time cycle.
          const { handleTeamAt } = await import('@main/core/team-rooms/conductor');
          await handleTeamAt(conversationId, to, message);
        }
        return;
      }
      if (raw.type === 'team-verdict') {
        const conversationId = parsePtyId(raw.ptyId)?.conversationId;
        let verdict: 'pass' | 'fail' | null = null;
        let message = '';
        try {
          const payload = JSON.parse(raw.body || '{}') as { verdict?: unknown; message?: unknown };
          verdict =
            payload.verdict === 'pass' ? 'pass' : payload.verdict === 'fail' ? 'fail' : null;
          message = typeof payload.message === 'string' ? payload.message : '';
        } catch {
          return;
        }
        if (conversationId && verdict) {
          const { handleTeamVerdict } = await import('@main/core/team-rooms/conductor');
          await handleTeamVerdict(conversationId, verdict, message);
        }
        return;
      }
      if (raw.type === 'team-status') {
        const conversationId = parsePtyId(raw.ptyId)?.conversationId;
        let message = '';
        try {
          const payload = JSON.parse(raw.body || '{}') as { message?: unknown };
          message = typeof payload.message === 'string' ? payload.message : '';
        } catch {
          return;
        }
        if (conversationId && message.trim()) {
          const { handleTeamStatus } = await import('@main/core/team-rooms/conductor');
          await handleTeamStatus(conversationId, message);
        }
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
