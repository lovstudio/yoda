import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { activeTabDrag } from '@renderer/app/tab-drag';
import { ConversationDragHandle } from '@renderer/features/tasks/conversations/conversation-drag-handle';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe('ConversationDragHandle', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    await act(async () => root.unmount());
    host.remove();
  });

  it('starts the shared cross-surface drag with the session ownership payload', async () => {
    await act(async () => {
      root.render(
        createElement(ConversationDragHandle, {
          projectId: 'project-1',
          taskId: 'task-1',
          conversationId: 'conversation-1',
        })
      );
    });

    const handle = host.querySelector('button');
    expect(handle?.getAttribute('aria-label')).toBe('tasks.conversations.moveToTask');

    await act(async () => {
      handle?.dispatchEvent(
        new MouseEvent('mousedown', { bubbles: true, button: 0, clientX: 10, clientY: 10 })
      );
      window.dispatchEvent(
        new MouseEvent('mousemove', { bubbles: true, clientX: 30, clientY: 30 })
      );
    });

    expect(activeTabDrag()).toEqual({
      kind: 'conversation-transfer',
      projectId: 'project-1',
      sourceTaskId: 'task-1',
      conversationId: 'conversation-1',
    });
  });
});
