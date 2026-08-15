import { queryOptions } from '@tanstack/react-query';
import type {
  ClaudeSessionPrompt,
  Conversation,
  SessionCompaction,
  SessionTranscriptMessage,
} from '@shared/conversations';
import { rpc } from '@renderer/lib/ipc';

export const SESSION_PROMPTS_REFRESH_MS = 3_000;
export const SESSION_PROMPTS_IDLE_REFRESH_MS = 15_000;

type VisibleRefreshOptions = {
  runImmediately?: boolean;
  isVisible?: () => boolean;
  subscribeVisibility?: (listener: () => void) => () => void;
  setIntervalFn?: (listener: () => void, intervalMs: number) => ReturnType<typeof setInterval>;
  clearIntervalFn?: (timer: ReturnType<typeof setInterval>) => void;
};

export type SessionConversationData = {
  prompts: ClaudeSessionPrompt[];
  messages: SessionTranscriptMessage[];
  /** Where the runtime compacted context, so history can mark the boundaries. */
  compactions: SessionCompaction[];
};

const EMPTY_SESSION_CONVERSATION: SessionConversationData = {
  prompts: [],
  messages: [],
  compactions: [],
};

export function sessionConversationQueryKey(
  conversation: Conversation | null,
  cwd: string,
  sessionId?: string
) {
  return [
    'sessionConversation',
    conversation?.runtimeId ?? 'none',
    cwd,
    conversation?.id ?? '',
    sessionId ?? conversation?.sessionSource?.sessionId ?? '',
    conversation?.title ?? '',
    conversation?.createdAt ?? '',
  ] as const;
}

export function getSessionConversationRefreshInterval(runtimeStatus?: string): number {
  return runtimeStatus === 'working' ? SESSION_PROMPTS_REFRESH_MS : SESSION_PROMPTS_IDLE_REFRESH_MS;
}

/** Shared React Query configuration for every prompt-history surface. */
export function sessionConversationQueryOptions({
  active,
  conversation,
  cwd,
  runtimeStatus,
  sessionId,
}: {
  active: boolean;
  conversation: Conversation | null;
  cwd: string;
  runtimeStatus?: string;
  sessionId?: string;
}) {
  return queryOptions({
    queryKey: sessionConversationQueryKey(conversation, cwd, sessionId),
    queryFn: () =>
      conversation
        ? resolveSessionConversation(conversation, cwd, sessionId)
        : Promise.resolve(EMPTY_SESSION_CONVERSATION),
    enabled: active && Boolean(conversation && cwd),
    staleTime: getSessionConversationRefreshInterval(runtimeStatus) - 250,
    refetchInterval:
      active && conversation && cwd
        ? getSessionConversationRefreshInterval(runtimeStatus)
        : (false as const),
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });
}

/**
 * Runs one non-overlapping refresh loop while the renderer is visible. The
 * branch-tree loader still uses this because it refreshes a derived lineage,
 * while single-session surfaces use the shared React Query above.
 */
export function startVisibleSessionRefresh(
  load: () => void | Promise<void>,
  options: VisibleRefreshOptions = {}
): () => void {
  const isVisible = options.isVisible ?? (() => document.visibilityState !== 'hidden');
  const subscribeVisibility =
    options.subscribeVisibility ??
    ((listener: () => void) => {
      document.addEventListener('visibilitychange', listener);
      return () => document.removeEventListener('visibilitychange', listener);
    });
  const setIntervalFn = options.setIntervalFn ?? setInterval;
  const clearIntervalFn = options.clearIntervalFn ?? clearInterval;
  let stopped = false;
  let inFlight = false;

  const refresh = () => {
    if (stopped || inFlight || !isVisible()) return;
    inFlight = true;
    void Promise.resolve()
      .then(load)
      .catch(() => undefined)
      .finally(() => {
        inFlight = false;
      });
  };

  if (options.runImmediately !== false) refresh();
  const timer = setIntervalFn(refresh, SESSION_PROMPTS_REFRESH_MS);
  const unsubscribeVisibility = subscribeVisibility(refresh);

  return () => {
    stopped = true;
    clearIntervalFn(timer);
    unsubscribeVisibility();
  };
}

/** Resolves user prompts plus readable user/assistant messages for a session. */
export async function resolveSessionConversation(
  conversation: Conversation,
  cwd: string,
  sessionId?: string
): Promise<SessionConversationData> {
  try {
    if (conversation.runtimeId === 'claude') {
      const context = await rpc.conversations.getClaudeSessionConversation(
        cwd,
        sessionId || conversation.id
      );
      return {
        prompts: context?.prompts ?? [],
        messages: context?.messages ?? [],
        compactions: context?.compactions ?? [],
      };
    }

    if (conversation.runtimeId === 'codex') {
      const context = await rpc.conversations.getCodexSessionConversation(
        cwd,
        conversation.id,
        conversation.title,
        conversation.createdAt ?? null
      );
      return {
        prompts: context?.prompts ?? [],
        messages: context?.messages ?? [],
        compactions: context?.compactions ?? [],
      };
    }

    if (conversation.runtimeId === 'cohub') {
      const context = await rpc.conversations.getCohubSessionContext(conversation.id);
      return {
        prompts: context?.prompts ?? [],
        messages: context?.messages ?? [],
        compactions: context?.compactions ?? [],
      };
    }
  } catch {
    return EMPTY_SESSION_CONVERSATION;
  }

  return EMPTY_SESSION_CONVERSATION;
}

/** Resolves the user-prompt history for a conversation across supported runtimes. */
export async function resolveSessionPrompts(
  conversation: Conversation,
  cwd: string,
  sessionId?: string
): Promise<ClaudeSessionPrompt[]> {
  return (await resolveSessionConversation(conversation, cwd, sessionId)).prompts;
}
