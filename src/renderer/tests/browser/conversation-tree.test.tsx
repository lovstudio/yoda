import {
  act,
  createElement,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type ReactNode,
} from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Conversation } from '@shared/conversations';
import type { ConversationStore } from '@renderer/features/tasks/conversations/conversation-manager';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  buildSections: vi.fn(() => [] as ReactNode[][]),
  openActive: vi.fn(),
  reopenArchived: vi.fn(async () => {}),
  showTranscript: vi.fn(),
  provisioned: { conversations: { conversations: new Map() } },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: { index?: number }) =>
      key === 'tasks.conversationTree.forkedFromPrompt' ? `fork-${values?.index}` : key,
  }),
}));

vi.mock('@renderer/app/app-tab-context-menu', () => ({
  buildConversationSections: mocks.buildSections,
}));

vi.mock('@renderer/lib/components/chip-context-menu', async () => {
  const { createElement: create } = await import('react');
  return {
    ChipContextMenu: ({ children }: { children: ReactNode }) => create('div', null, children),
  };
});

vi.mock('@renderer/lib/components/agent-logo', async () => {
  const { createElement: create } = await import('react');
  return { default: ({ alt }: { alt: string }) => create('span', { 'data-agent': alt }) };
});

vi.mock('@renderer/lib/components/tree-guide-slot', async () => {
  const { createElement: create } = await import('react');
  return {
    TreeGuideSlot: () => create('span', { 'data-tree-guide': true }),
  };
});

vi.mock('@renderer/lib/modal/modal-provider', () => ({
  useShowModal: () => mocks.showTranscript,
}));

vi.mock('@renderer/lib/ui/button', async () => {
  const { createElement: create } = await import('react');
  return {
    Button: ({
      children,
      size: _size,
      variant: _variant,
      ...props
    }: ButtonHTMLAttributes<HTMLButtonElement> & { size?: string; variant?: string }) =>
      create('button', props, children),
  };
});

vi.mock('@renderer/lib/ui/context-menu', async () => {
  const { createElement: create } = await import('react');
  return {
    ContextMenuItem: ({ children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) =>
      create('button', props, children),
  };
});

vi.mock('@renderer/lib/ui/relative-time', async () => {
  const { createElement: create } = await import('react');
  return {
    RelativeTime: ({ value, ...props }: HTMLAttributes<HTMLTimeElement> & { value: string }) =>
      create('time', props, value),
  };
});

vi.mock('@renderer/utils/agentConfig', () => ({
  agentConfig: {
    codex: { logo: '', alt: 'Codex', isSvg: true, invertInDark: false },
  },
}));

vi.mock('@renderer/utils/logger', () => ({
  log: { warn: vi.fn() },
}));

vi.mock('@renderer/features/tasks/components/agent-status-indicator', () => ({
  AgentStatusIndicator: () => null,
}));

vi.mock('@renderer/features/tasks/components/persisted-disclosure', async () => {
  const { useState } = await import('react');
  return {
    usePersistedDisclosure: (_id: string, defaultOpen: boolean) => useState(defaultOpen),
  };
});

vi.mock('@renderer/features/tasks/components/session-usage-chip', () => ({
  SessionUsageChip: () => null,
}));

vi.mock('@renderer/features/tasks/task-view-context', () => ({
  useProvisionedTask: () => mocks.provisioned,
  useTaskViewContext: () => ({ projectId: 'project-1', taskId: 'task-1' }),
}));

vi.mock('@renderer/features/tasks/conversations/conversation-title-utils', () => ({
  formatConversationTitleForDisplay: (_runtimeId: string, title: string) => title,
}));

vi.mock('@renderer/features/tasks/conversations/use-archived-conversations', () => ({
  reopenArchivedConversation: mocks.reopenArchived,
}));

function conversation(id: string, overrides: Partial<Conversation> = {}): Conversation {
  return {
    id,
    projectId: 'project-1',
    taskId: 'task-1',
    runtimeId: 'codex',
    title: id,
    createdAt: '2026-07-15T00:00:00.000Z',
    lastInteractedAt: '2026-07-15T00:00:00.000Z',
    isInitialConversation: false,
    ...overrides,
  };
}

function activeStore(data: Conversation): ConversationStore {
  return { data, indicatorStatus: null } as unknown as ConversationStore;
}

describe('ConversationTree', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    mocks.buildSections.mockClear();
    mocks.openActive.mockClear();
    mocks.reopenArchived.mockClear();
    mocks.showTranscript.mockClear();
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  async function renderTree({
    active = [],
    archived = [],
    activeConversationId,
  }: {
    active?: Conversation[];
    archived?: Conversation[];
    activeConversationId?: string;
  }): Promise<void> {
    const { ConversationTree } = await import(
      '@renderer/features/tasks/conversations/conversation-tree'
    );
    await act(async () => {
      root.render(
        createElement(ConversationTree, {
          activeConversations: active.map(activeStore),
          archivedConversations: archived,
          activeConversationId,
          onOpenActive: mocks.openActive,
        })
      );
    });
  }

  it('renders nested branches, their fork point, and the current conversation', async () => {
    await renderTree({
      active: [
        conversation('root'),
        conversation('child', {
          forkedFromConversationId: 'root',
          forkedFromPromptIndex: 2,
        }),
      ],
      activeConversationId: 'child',
    });

    expect(host.querySelectorAll('[data-conversation-tree-item]')).toHaveLength(2);
    expect(host.textContent).toContain('fork-3');
    const childButton = host.querySelector('button[title="child"]');
    expect(childButton?.getAttribute('aria-current')).toBe('page');
    const childItem = childButton?.closest('[data-conversation-tree-item]');
    expect(childItem?.querySelector('[data-tree-guide]')).not.toBeNull();
    expect(childItem?.querySelector('[data-conversation-tree-row] [data-tree-guide]')).toBeNull();
    expect(mocks.buildSections).toHaveBeenCalledWith(
      mocks.provisioned,
      'project-1',
      'task-1',
      'child',
      expect.any(Function)
    );
  });

  it('keeps branch toggling separate from opening a conversation', async () => {
    await renderTree({
      active: [
        conversation('root'),
        conversation('child', {
          forkedFromConversationId: 'root',
          forkedFromPromptIndex: 0,
        }),
      ],
    });

    const collapse = host.querySelector<HTMLButtonElement>(
      'button[aria-label="tasks.conversationTree.collapseBranches"]'
    );
    await act(async () => collapse?.click());

    expect(host.querySelector('button[title="child"]')).toBeNull();
    expect(mocks.openActive).not.toHaveBeenCalled();

    const rootButton = host.querySelector<HTMLButtonElement>('button[title="root"]');
    await act(async () => rootButton?.click());
    expect(mocks.openActive).toHaveBeenCalledWith('root');
  });

  it('reveals a previously collapsed path when the active conversation changes', async () => {
    const active = [
      conversation('root'),
      conversation('child', {
        forkedFromConversationId: 'root',
        forkedFromPromptIndex: 0,
      }),
    ];
    await renderTree({ active });

    const collapse = host.querySelector<HTMLButtonElement>(
      'button[aria-label="tasks.conversationTree.collapseBranches"]'
    );
    await act(async () => collapse?.click());
    expect(host.querySelector('button[title="child"]')).toBeNull();

    await renderTree({ active, activeConversationId: 'child' });
    expect(host.querySelector('button[title="child"]')).not.toBeNull();

    const collapseActivePath = host.querySelector<HTMLButtonElement>(
      'button[aria-label="tasks.conversationTree.collapseBranches"]'
    );
    await act(async () => collapseActivePath?.click());
    expect(host.querySelector('button[title="child"]')).toBeNull();
  });

  it('opens archived transcripts on row click and restores only from the explicit action', async () => {
    const archived = conversation('archived', {
      archivedAt: '2026-07-15T00:10:00.000Z',
    });
    await renderTree({ archived: [archived] });

    const transcript = host.querySelector<HTMLButtonElement>(
      'button[title="tasks.archivedSession.viewTranscript"]'
    );
    await act(async () => transcript?.click());
    expect(mocks.showTranscript).toHaveBeenCalledWith({ conversation: archived });
    expect(mocks.reopenArchived).not.toHaveBeenCalled();

    const restore = host.querySelector<HTMLButtonElement>(
      'button[aria-label="tasks.archivedSession.restore"]'
    );
    await act(async () => restore?.click());
    expect(mocks.reopenArchived).toHaveBeenCalledWith(archived);
    expect(mocks.buildSections).toHaveBeenCalledWith(
      undefined,
      'project-1',
      'task-1',
      'archived',
      expect.any(Function)
    );
  });
});
