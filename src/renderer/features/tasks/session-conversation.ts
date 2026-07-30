import type { AgentReplyDisplayLevel } from '@shared/agent-reply-display';
import type { ClaudeSessionPrompt, SessionTranscriptMessage } from '@shared/conversations';

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
  const items: SessionConversationItem[] = [];
  messages.forEach((message, index) => {
    if (message.role !== 'user' && level !== 'detailed' && message.phase !== 'final') {
      return;
    }

    const visibleMessage =
      message.role === 'assistant'
        ? { ...message, text: visibleAgentReplyText(message.text) }
        : message;
    if (!visibleMessage.text) return;

    const previous = items[items.length - 1]?.message;
    if (
      previous?.role === 'assistant' &&
      previous.phase === 'final' &&
      visibleMessage.role === 'assistant' &&
      visibleMessage.phase === 'final' &&
      previous.text === visibleMessage.text
    ) {
      items[items.length - 1] = {
        key: `${visibleMessage.role}:${visibleMessage.id}:${index}`,
        message: visibleMessage,
      };
      return;
    }

    const match =
      visibleMessage.role === 'user'
        ? findMatchingPrompt(prompts, usedPromptIndexes, visibleMessage)
        : undefined;
    items.push({
      key: `${visibleMessage.role}:${visibleMessage.id}:${index}`,
      message: visibleMessage,
      ...(match
        ? {
            prompt: match.prompt,
            promptIndex: promptNumbers?.[match.index] ?? match.index + 1,
          }
        : {}),
    });
  });
  return items;
}

function visibleAgentReplyText(text: string): string {
  return text.replace(/<oai-mem-citation>[\s\S]*?<\/oai-mem-citation>/gi, '').trim();
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
