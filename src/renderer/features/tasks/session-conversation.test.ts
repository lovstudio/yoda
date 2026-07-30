import { describe, expect, it } from 'vitest';
import type { ClaudeSessionPrompt, SessionTranscriptMessage } from '@shared/conversations';
import {
  buildSessionConversationItems,
  buildSessionConversationPreviewItems,
} from './session-conversation';

const prompts: ClaudeSessionPrompt[] = [
  {
    id: 'user-1',
    text: 'Build the feature',
    timestamp: null,
    restoreTarget: { kind: 'codex-turn', turnId: 'turn-1' },
  },
  { id: 'user-2', text: 'Polish it', timestamp: null },
];

const messages: SessionTranscriptMessage[] = [
  { id: 'user-1', role: 'user', text: 'Build the feature', timestamp: null },
  {
    id: 'assistant-1',
    role: 'assistant',
    text: 'I will inspect the code.',
    timestamp: null,
    phase: 'commentary',
  },
  {
    id: 'assistant-2',
    role: 'assistant',
    text: 'Implemented and tested.',
    timestamp: null,
    phase: 'final',
  },
  { id: 'user-2', role: 'user', text: 'Polish it', timestamp: null },
];

describe('buildSessionConversationItems', () => {
  it('keeps user-only mode prompt-backed for restore actions', () => {
    const items = buildSessionConversationItems(prompts, messages, 'hidden');

    expect(items.map((item) => item.message.text)).toEqual(['Build the feature', 'Polish it']);
    expect(items[0]?.prompt?.restoreTarget).toEqual({
      kind: 'codex-turn',
      turnId: 'turn-1',
    });
    expect(items[0]?.promptIndex).toBe(1);
  });

  it('shows only final agent replies in concise mode', () => {
    expect(
      buildSessionConversationItems(prompts, messages, 'concise').map((item) => item.message.text)
    ).toEqual(['Build the feature', 'Implemented and tested.', 'Polish it']);
  });

  it('shows every readable agent reply in detailed mode', () => {
    expect(
      buildSessionConversationItems(prompts, messages, 'detailed').map((item) => item.message.text)
    ).toEqual([
      'Build the feature',
      'I will inspect the code.',
      'Implemented and tested.',
      'Polish it',
    ]);
  });

  it('preserves restore actions when runtime prompt and message ids differ', () => {
    const items = buildSessionConversationItems(
      prompts,
      [{ id: 'event-user-1', role: 'user', text: 'Build the feature', timestamp: null }],
      'concise'
    );

    expect(items[0]?.promptIndex).toBe(1);
    expect(items[0]?.prompt?.restoreTarget).toEqual({
      kind: 'codex-turn',
      turnId: 'turn-1',
    });
  });

  it('keeps original transcript positions for prompt subsets', () => {
    const items = buildSessionConversationItems([prompts[0]!], [], 'hidden', [5]);

    expect(items[0]?.promptIndex).toBe(5);
  });

  it('deduplicates consecutive final replies by their user-visible text', () => {
    const duplicatedFinal = 'Implemented and tested.';
    const items = buildSessionConversationItems(
      prompts,
      [
        messages[0]!,
        {
          id: 'assistant-response-item',
          role: 'assistant',
          text: `${duplicatedFinal}

<oai-mem-citation>
internal metadata
</oai-mem-citation>`,
          timestamp: '2026-07-30T08:09:37.052Z',
          phase: 'final',
        },
        {
          id: 'assistant-task-complete',
          role: 'assistant',
          text: duplicatedFinal,
          timestamp: '2026-07-30T08:09:37.053Z',
          phase: 'final',
        },
        messages[3]!,
      ],
      'concise'
    );

    expect(items.map((item) => item.message.text)).toEqual([
      'Build the feature',
      duplicatedFinal,
      'Polish it',
    ]);
  });

  it('keeps identical final replies when a user turn separates them', () => {
    const repeatedFinal = 'Done.';
    const items = buildSessionConversationItems(
      prompts,
      [
        messages[0]!,
        {
          id: 'assistant-1',
          role: 'assistant',
          text: repeatedFinal,
          timestamp: null,
          phase: 'final',
        },
        messages[3]!,
        {
          id: 'assistant-2',
          role: 'assistant',
          text: repeatedFinal,
          timestamp: null,
          phase: 'final',
        },
      ],
      'concise'
    );

    expect(items.filter((item) => item.message.role === 'assistant')).toHaveLength(2);
  });
});

describe('buildSessionConversationPreviewItems', () => {
  it('keeps the beginning and end while reporting the hidden middle', () => {
    const items = Array.from({ length: 8 }, (_, index) => ({
      key: String(index),
      message: {
        id: String(index),
        role: 'user' as const,
        text: String(index),
        timestamp: null,
      },
    }));

    expect(
      buildSessionConversationPreviewItems(items).map((item) =>
        item.type === 'truncated' ? `hidden:${item.hiddenCount}` : item.item.message.text
      )
    ).toEqual(['0', '1', '2', 'hidden:2', '5', '6', '7']);
  });
});
