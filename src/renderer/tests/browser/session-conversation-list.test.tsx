import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClaudeSessionPrompt } from '@shared/conversations';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@renderer/lib/ui/markdown-renderer', () => ({
  MarkdownRenderer: ({ content }: { content: string }) => createElement('div', null, content),
}));

function makePrompts(count: number): ClaudeSessionPrompt[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `prompt-${index + 1}`,
    text: `Prompt ${index + 1}`,
    timestamp: null,
  }));
}

describe('SessionConversationList', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  it('renders every prompt in the compact conversation panel', async () => {
    const { SessionConversationList } = await import(
      '@renderer/features/tasks/session-conversation-list'
    );

    await act(async () => {
      root.render(
        createElement(SessionConversationList, {
          prompts: makePrompts(9),
          messages: [],
          displayLevel: 'hidden',
          variant: 'preview',
        })
      );
    });

    expect(host.querySelectorAll('article')).toHaveLength(9);
    expect(host.textContent).toContain('Prompt 1');
    expect(host.textContent).toContain('Prompt 9');
    expect(host.textContent).not.toContain('tasks.sessionInfo.truncatedMessages');
  });
});
