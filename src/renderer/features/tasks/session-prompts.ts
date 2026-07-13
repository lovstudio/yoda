import type { ClaudeSessionPrompt, Conversation } from '@shared/conversations';
import { rpc } from '@renderer/lib/ipc';

export const SESSION_PROMPTS_REFRESH_MS = 3_000;

/** Resolves the user-prompt history for a conversation across supported runtimes. */
export async function resolveSessionPrompts(
  conversation: Conversation,
  cwd: string,
  sessionId?: string
): Promise<ClaudeSessionPrompt[]> {
  try {
    if (conversation.runtimeId === 'claude') {
      const context = await rpc.conversations.getClaudeSessionContext(
        cwd,
        sessionId || conversation.id
      );
      return context?.prompts ?? [];
    }

    if (conversation.runtimeId === 'codex') {
      const context = await rpc.conversations.getCodexSessionContext(
        cwd,
        conversation.id,
        conversation.title,
        conversation.createdAt ?? null
      );
      return context?.prompts ?? [];
    }
  } catch {
    return [];
  }

  return [];
}
