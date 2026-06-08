import type { ClaudeSessionPrompt } from '@shared/conversations';

export const PROMPT_PREVIEW_EDGE_COUNT = 3;

export type PromptPreviewItem =
  | {
      type: 'prompt';
      prompt: ClaudeSessionPrompt;
      promptIndex: number;
    }
  | {
      type: 'truncated';
      hiddenCount: number;
    };

export function buildPromptPreviewItems(
  prompts: ClaudeSessionPrompt[],
  edgeCount = PROMPT_PREVIEW_EDGE_COUNT
): PromptPreviewItem[] {
  const visibleLimit = edgeCount * 2;
  if (edgeCount <= 0 || prompts.length <= visibleLimit) {
    return prompts.map((prompt, index) => ({
      type: 'prompt',
      prompt,
      promptIndex: index + 1,
    }));
  }

  const head = prompts.slice(0, edgeCount).map((prompt, index) => ({
    type: 'prompt' as const,
    prompt,
    promptIndex: index + 1,
  }));
  const tailStartIndex = prompts.length - edgeCount;
  const tail = prompts.slice(tailStartIndex).map((prompt, index) => ({
    type: 'prompt' as const,
    prompt,
    promptIndex: tailStartIndex + index + 1,
  }));

  return [
    ...head,
    {
      type: 'truncated',
      hiddenCount: prompts.length - visibleLimit,
    },
    ...tail,
  ];
}
