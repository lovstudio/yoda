import { useTaskStats } from '@renderer/features/tasks/hooks/useTaskStats';
import { getUsageTone } from './display';
import { useRuntimeBarSession } from './session-context';

/**
 * Token and context-window usage for the session the bar is describing.
 *
 * Both the context entry and the account-usage entry read it — usage falls back
 * to the rate limits the transcript reports when no account reading is
 * available. They share one hook so they cannot disagree about the query's
 * shape; React Query then serves both from a single observer.
 */
export function useRuntimeBarSessionUsage() {
  const { route, activeProjectId, activeTaskId, activeConversationId } = useRuntimeBarSession();
  const { data: taskStats } = useTaskStats(activeProjectId ?? '', activeTaskId ?? '', {
    enabled: Boolean(route === 'task' && activeProjectId && activeTaskId && activeConversationId),
    // Codex appends live context-window snapshots to its rollout while a turn
    // is running. Keep the status bar current without waiting for session exit.
    refetchInterval: activeConversationId ? 15_000 : false,
  });
  const activeSessionUsage =
    route === 'task' && activeConversationId
      ? (taskStats?.conversations.find((item) => item.conversationId === activeConversationId) ??
        null)
      : null;
  const sessionContext = activeSessionUsage?.context ?? null;
  const contextPercent = sessionContext
    ? Math.round((sessionContext.usedTokens / sessionContext.limitTokens) * 100)
    : null;

  return {
    sessionTokens: activeSessionUsage?.tokens ?? null,
    sessionContext,
    contextPercent,
    contextRemaining: sessionContext
      ? Math.max(0, sessionContext.limitTokens - sessionContext.usedTokens)
      : null,
    contextTone: contextPercent != null ? getUsageTone(contextPercent) : 'bg-emerald-500',
  };
}
