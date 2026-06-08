import { describe, expect, it } from 'vitest';
import type { ClaudeSessionPrompt } from '@shared/conversations';
import { buildPromptPreviewItems } from './session-prompts-preview';

function makePrompts(count: number): ClaudeSessionPrompt[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `prompt-${index + 1}`,
    text: `Prompt ${index + 1}`,
    timestamp: null,
  }));
}

function itemKey(item: ReturnType<typeof buildPromptPreviewItems>[number]): string {
  if (item.type === 'truncated') return `truncated:${item.hiddenCount}`;
  return `prompt:${item.promptIndex}`;
}

describe('buildPromptPreviewItems', () => {
  it('shows all prompts when the list fits the preview window', () => {
    expect(buildPromptPreviewItems(makePrompts(6)).map(itemKey)).toEqual([
      'prompt:1',
      'prompt:2',
      'prompt:3',
      'prompt:4',
      'prompt:5',
      'prompt:6',
    ]);
  });

  it('keeps the first three and last three prompts with a truncated middle', () => {
    expect(buildPromptPreviewItems(makePrompts(8)).map(itemKey)).toEqual([
      'prompt:1',
      'prompt:2',
      'prompt:3',
      'truncated:2',
      'prompt:6',
      'prompt:7',
      'prompt:8',
    ]);
  });
});
