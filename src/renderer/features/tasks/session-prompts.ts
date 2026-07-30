import type {
  ClaudeSessionPrompt,
  Conversation,
  SessionTranscriptMessage,
} from '@shared/conversations';
import { rpc } from '@renderer/lib/ipc';

export const SESSION_PROMPTS_REFRESH_MS = 3_000;

export type SessionConversationData = {
  prompts: ClaudeSessionPrompt[];
  messages: SessionTranscriptMessage[];
};

const EMPTY_SESSION_CONVERSATION: SessionConversationData = {
  prompts: [],
  messages: [],
};

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
