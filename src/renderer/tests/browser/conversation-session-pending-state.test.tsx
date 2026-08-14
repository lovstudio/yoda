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

  it('shows only the Yoda mark while an existing session opens', async () => {
    await act(async () => {
      root.render(
        createElement(ConversationSessionPendingState, {
          title: 'Fix the blank session',
          heading: 'Opening conversation',
          description: 'Preparing the conversation.',
        })
      );
    });

    const status = host.querySelector('[role="status"]');
    expect(status?.getAttribute('aria-label')).toBe('Preparing the conversation.');
    expect(status?.textContent).toBe('');
    expect(host.querySelector('[data-yoda-opening-mark]')).not.toBeNull();
    expect(host.querySelector('.lucide-loader-circle')).toBeNull();
  });

  it('keeps recovery details and actions visible when opening fails', async () => {
    await act(async () => {
      root.render(
        createElement(ConversationSessionPendingState, {
          title: 'Fix the blank session',
          heading: 'Opening needs attention',
          description: 'The terminal did not finish preparing.',
          error: {
            retryLabel: 'Retry',
            onRetry: () => {},
            copyDebugLabel: 'Copy debug info',
            debugCopiedLabel: 'Debug info copied',
            debugCopied: false,
            onCopyDebug: () => {},
          },
        })
      );
    });

    expect(host.textContent).toContain('Opening needs attention');
    expect(host.textContent).toContain('The terminal did not finish preparing.');
    expect(host.textContent).toContain('Fix the blank session');
    expect(host.textContent).toContain('Retry');
    expect(host.querySelector('[data-yoda-opening-mark]')).toBeNull();
  });
});
