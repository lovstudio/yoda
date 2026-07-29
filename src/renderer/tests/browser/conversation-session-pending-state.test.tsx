import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ConversationSessionPendingState } from '@renderer/features/tasks/conversations/conversation-session-pending-state';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('ConversationSessionPendingState', () => {
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

  it('keeps a submitted session visible while its terminal starts', async () => {
    await act(async () => {
      root.render(
        createElement(ConversationSessionPendingState, {
          title: 'Fix the blank session',
          heading: 'Starting agent',
          description: 'Your message was submitted.',
        })
      );
    });

    expect(host.querySelector('[role="status"]')).not.toBeNull();
    expect(host.textContent).toContain('Fix the blank session');
    expect(host.textContent).toContain('Your message was submitted.');
  });
});
