import type {
  ClaudeSessionPrompt,
  Conversation,
  SessionTranscriptMessage,
} from '@shared/conversations';
import { rpc } from '@renderer/lib/ipc';

export const SESSION_PROMPTS_REFRESH_MS = 3_000;

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
};

const EMPTY_SESSION_CONVERSATION: SessionConversationData = {
  prompts: [],
  messages: [],
};

/**
 * Runs one non-overlapping session refresh loop while the renderer is visible.
 * Hidden windows pause transcript scans and refresh immediately when foregrounded.
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
      const context = await rpc.conversations.getClaudeSessionContext(
        cwd,
        sessionId || conversation.id
      );
      return {
        prompts: context?.prompts ?? [],
        messages: context?.messages ?? [],
      };
    }

    if (conversation.runtimeId === 'codex') {
      const context = await rpc.conversations.getCodexSessionContext(
        cwd,
        conversation.id,
        conversation.title,
        conversation.createdAt ?? null
      );
      return {
        prompts: context?.prompts ?? [],
        messages: context?.messages ?? [],
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
