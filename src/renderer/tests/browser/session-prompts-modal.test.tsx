import type { AgentReplyDisplayLevel } from '@lovstudio/yoda-protocol/agent-reply-display';
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../../index.css';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type ChildrenProps = {
  children?: ReactNode;
  className?: string;
};

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@renderer/lib/ui/dialog', () => ({
  DialogContentArea: ({ children, className }: ChildrenProps) =>
    createElement('div', { 'data-slot': 'dialog-content-area', className }, children),
  DialogHeader: ({ children, className }: ChildrenProps) =>
    createElement('div', { 'data-slot': 'dialog-header', className }, children),
  DialogTitle: ({ children, className }: ChildrenProps) =>
    createElement('h2', { 'data-slot': 'dialog-title', className }, children),
}));

vi.mock('@renderer/features/tasks/session-conversation-list', () => ({
  SessionConversationList: ({
    displayLevel,
  }: {
    displayLevel: Exclude<AgentReplyDisplayLevel, 'verbose'>;
  }) => createElement('div', { 'data-display-level': displayLevel }),
}));

describe('SessionPromptsModal', () => {
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

  it('hides AI replies by default and reveals final replies from hidden mode', async () => {
    const { SessionPromptsModal } = await import('@renderer/features/tasks/session-prompts-modal');

    await act(async () => {
      root.render(
        createElement(SessionPromptsModal, {
          prompts: [],
          messages: [],
          onSuccess: vi.fn(),
          onClose: vi.fn(),
        })
      );
    });

    const toggle = host.querySelector<HTMLElement>('[data-slot="switch"]');
    const conversation = () => host.querySelector<HTMLElement>('[data-display-level]');

    expect(toggle?.getAttribute('aria-checked')).toBe('false');
    expect(conversation()?.dataset.displayLevel).toBe('hidden');
    expect(host.querySelector('[data-slot="dialog-footer"]')).toBeNull();

    await act(async () => toggle?.click());

    expect(toggle?.getAttribute('aria-checked')).toBe('true');
    expect(conversation()?.dataset.displayLevel).toBe('concise');
  });

  it('restores the configured reply detail when enabled', async () => {
    const { SessionPromptsModal } = await import('@renderer/features/tasks/session-prompts-modal');

    await act(async () => {
      root.render(
        createElement(SessionPromptsModal, {
          prompts: [],
          messages: [],
          displayLevel: 'detailed',
          onSuccess: vi.fn(),
          onClose: vi.fn(),
        })
      );
    });

    const toggle = host.querySelector<HTMLElement>('[data-slot="switch"]');
    const conversation = () => host.querySelector<HTMLElement>('[data-display-level]');

    expect(conversation()?.dataset.displayLevel).toBe('hidden');

    await act(async () => toggle?.click());

    expect(conversation()?.dataset.displayLevel).toBe('detailed');
  });
});
