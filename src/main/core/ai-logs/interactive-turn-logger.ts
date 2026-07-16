import type { AgentEvent } from '@shared/events/agentEvents';
import { log } from '@main/lib/logger';
import { aiLogService } from './ai-log-service';

/**
 * Logs each interactive chat turn into the AI invocation log. Turn boundaries
 * come from agent hook events: `prompt-submit` (Claude's UserPromptSubmit —
 * fires for prompts typed directly in the TUI and ones sent from Yoda's input
 * box alike) opens a row, `stop`/`error` closes it. A new prompt or the
 * session exiting closes any turn left open (an Esc interrupt fires no Stop
 * hook, so the dangling row is settled by the next boundary instead).
 */
class InteractiveTurnLogger {
  /** conversationId → open ai_invocation_logs row id. */
  private openTurns = new Map<string, string>();
  private sessionContexts = new Map<
    string,
    { authProvider: string; maasPlatformId?: string; maasEffective: boolean }
  >();

  setSessionContext(
    conversationId: string,
    context: { authProvider: string; maasPlatformId?: string; maasEffective: boolean }
  ): void {
    this.sessionContexts.set(conversationId, context);
  }

  clearSessionContext(conversationId: string): void {
    this.sessionContexts.delete(conversationId);
  }

  async onAgentEvent(event: AgentEvent): Promise<void> {
    try {
      if (event.type === 'prompt-submit') {
        // A queued/interrupted previous turn never got its Stop — settle it.
        await this.close(event.conversationId, { status: 'succeeded' });
        const context = this.sessionContexts.get(event.conversationId);
        const logId = await aiLogService.start({
          purpose: 'interactive-turn',
          mode: 'interactive',
          runtime: event.runtimeId ?? 'unknown',
          prompt: event.payload.prompt ?? null,
          metadata: {
            projectId: event.projectId,
            taskId: event.taskId,
            conversationId: event.conversationId,
            ...(context
              ? {
                  authProvider: context.authProvider,
                  maasEffective: String(context.maasEffective),
                  ...(context.maasPlatformId ? { maasPlatformId: context.maasPlatformId } : {}),
                }
              : {}),
          },
        });
        this.openTurns.set(event.conversationId, logId);
        return;
      }
      if (event.type === 'stop') {
        await this.close(event.conversationId, {
          status: 'succeeded',
          output: event.payload.lastAssistantMessage ?? null,
        });
        return;
      }
      if (event.type === 'error') {
        await this.close(event.conversationId, {
          status: 'failed',
          error: event.payload.message ?? 'Agent reported an error.',
        });
      }
    } catch (error) {
      log.warn('[ai-log] interactive turn logging failed', { error: String(error) });
    }
  }

  /** Settles a dangling turn when its PTY session exits. */
  async onSessionExit(conversationId: string): Promise<void> {
    try {
      await this.close(conversationId, {
        status: 'failed',
        error: 'Session exited before the turn completed.',
      });
    } catch (error) {
      log.warn('[ai-log] interactive turn exit logging failed', { error: String(error) });
    } finally {
      this.sessionContexts.delete(conversationId);
    }
  }

  private async close(
    conversationId: string,
    input: { status: 'succeeded' | 'failed'; output?: string | null; error?: string | null }
  ): Promise<void> {
    const logId = this.openTurns.get(conversationId);
    if (!logId) return;
    this.openTurns.delete(conversationId);
    await aiLogService.finish(logId, input);
  }
}

export const interactiveTurnLogger = new InteractiveTurnLogger();
