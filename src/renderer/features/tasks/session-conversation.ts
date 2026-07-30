import type { InterfaceSettings } from '@shared/app-settings';
import type { ClaudeSessionPrompt, SessionTranscriptMessage } from '@shared/conversations';

export type AgentReplyDisplayLevel = InterfaceSettings['agentReplyDisplayLevel'];

export const AGENT_REPLY_DISPLAY_LEVELS = [
  'hidden',
  'concise',
  'detailed',
  'verbose',
] as const satisfies readonly AgentReplyDisplayLevel[];

export function isAgentReplyDisplayLevel(value: unknown): value is AgentReplyDisplayLevel {
  return AGENT_REPLY_DISPLAY_LEVELS.includes(value as AgentReplyDisplayLevel);
}

export type SessionConversationItem = {
  key: string;
  message: SessionTranscriptMessage;
  prompt?: ClaudeSessionPrompt;
  promptIndex?: number;
};

export type SessionConversationPreviewItem =
  | {
      type: 'message';
      item: SessionConversationItem;
    }
  | {
      type: 'truncated';
      hiddenCount: number;
    };

/**
 * Builds the readable conversation for the selected level. User-only mode
 * stays prompt-backed so restore checkpoints remain available.
 */
export function buildSessionConversationItems(
  prompts: ClaudeSessionPrompt[],
  messages: SessionTranscriptMessage[],
  level: Exclude<AgentReplyDisplayLevel, 'verbose'>,
  promptNumbers?: number[]
): SessionConversationItem[] {
  if (level === 'hidden' || messages.length === 0) {
    return prompts.map((prompt, index) => ({
      key: `user:${prompt.id}:${index}`,
      message: {
        id: prompt.id,
        role: 'user',
        text: prompt.text,
        timestamp: prompt.timestamp,
      },
      prompt,
      promptIndex: promptNumbers?.[index] ?? index + 1,
    }));
  }

  const usedPromptIndexes = new Set<number>();
  return messages
    .filter(
      (message) => message.role === 'user' || level === 'detailed' || message.phase === 'final'
    )
    .map((message, index) => {
      const match =
        message.role === 'user'
          ? findMatchingPrompt(prompts, usedPromptIndexes, message)
          : undefined;
      return {
        key: `${message.role}:${message.id}:${index}`,
        message,
        ...(match
          ? {
              prompt: match.prompt,
              promptIndex: promptNumbers?.[match.index] ?? match.index + 1,
            }
          : {}),
      };
    });
}

function findMatchingPrompt(
  prompts: ClaudeSessionPrompt[],
  usedPromptIndexes: Set<number>,
  message: SessionTranscriptMessage
): { prompt: ClaudeSessionPrompt; index: number } | undefined {
  let promptIndex = prompts.findIndex(
    (prompt, index) => !usedPromptIndexes.has(index) && prompt.id === message.id
  );
  if (promptIndex < 0) {
    promptIndex = prompts.findIndex(
      (prompt, index) => !usedPromptIndexes.has(index) && prompt.text === message.text
    );
  }
  const prompt = prompts[promptIndex];
  if (!prompt) return undefined;
  usedPromptIndexes.add(promptIndex);
  return { prompt, index: promptIndex };
}

export function buildSessionConversationPreviewItems(
  items: SessionConversationItem[],
  headCount = 3,
  tailCount = headCount
): SessionConversationPreviewItem[] {
  const safeHeadCount = Math.max(0, headCount);
  const safeTailCount = Math.max(0, tailCount);
  const visibleLimit = safeHeadCount + safeTailCount;
  if (items.length <= visibleLimit) {
    return items.map((item) => ({ type: 'message', item }));
  }

  return [
    ...items.slice(0, safeHeadCount).map((item) => ({ type: 'message' as const, item })),
    {
      type: 'truncated',
      hiddenCount: items.length - visibleLimit,
    },
    ...items.slice(items.length - safeTailCount).map((item) => ({
      type: 'message' as const,
      item,
    })),
  ];
}
