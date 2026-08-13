import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  archivedHook: vi.fn(),
  conversationValues: vi.fn(),
  historyActive: vi.fn(),
  paneSessionIds: vi.fn(),
  provisioned: null as unknown,
  routeConversationId: 'conversation-1',
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@renderer/features/tasks/conversations/session-history-panel', async () => {
  const { createElement: create } = await import('react');
  return {
    DockedSessionHistory: ({ active }: { active?: boolean }) => {
      mocks.historyActive(active);
      return create('div', { 'data-history-active': String(active) });
    },
  };
});

vi.mock('@renderer/features/tasks/hooks/use-is-active-task', () => ({
  useIsActiveTask: () => true,
}));

vi.mock('@renderer/features/tasks/split-view/split-view-store', () => ({
  splitViewStore: { has: () => false },
}));

vi.mock('@renderer/features/tasks/task-view-context', () => ({
  useTaskViewContext: () => ({ projectId: 'project-1', taskId: 'task-1' }),
  useRequireProvisionedTask: () => mocks.provisioned,
}));

vi.mock('@renderer/lib/layout/navigation-provider', () => ({
  useParams: () => ({
    params: {
      tab: { kind: 'conversation', conversationId: mocks.routeConversationId },
    },
  }),
}));

vi.mock('@renderer/lib/modal/modal-provider', () => ({
  useShowModal: () => vi.fn(),
}));

vi.mock('@renderer/lib/ipc', () => ({ events: {}, rpc: {} }));

vi.mock('@renderer/lib/pty/pane-sizing-context', async () => {
  const { createElement: create } = await import('react');
  return {
    PaneSizingProvider: ({
      sessionIds,
      children,
    }: {
      sessionIds: string[];
      children: React.ReactNode;
    }) => {
      mocks.paneSessionIds(sessionIds);
      return create('div', { 'data-pane-session-ids': sessionIds.join(',') }, children);
    },
  };
});

vi.mock('@renderer/features/tasks/components/session-opening-surface', () => ({
  SessionOpeningSurface: () => createElement('div', null, 'opening'),
}));

vi.mock('@renderer/features/tasks/conversations/conversation-session', () => ({
  ConversationSession: () => createElement('div', { 'data-conversation-session': true }),
  getResumeInitialSize: vi.fn(),
}));

vi.mock('@renderer/features/tasks/conversations/conversation-tree', () => ({
  ConversationTree: () => createElement('div'),
}));

vi.mock('@renderer/features/tasks/conversations/use-archived-conversations', () => ({
  useArchivedConversations: (...args: unknown[]) => mocks.archivedHook(...args),
}));

vi.mock('@renderer/utils/logger', () => ({
  log: { level: 'info', debug: vi.fn() },
}));

describe('ConversationsPanel active-session fast path', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    mocks.archivedHook.mockReset().mockReturnValue([]);
    mocks.conversationValues.mockReset().mockImplementation(() => {
      throw new Error('active session enumerated the conversation collection');
    });
    mocks.historyActive.mockReset();
    mocks.paneSessionIds.mockReset();
    mocks.routeConversationId = 'conversation-1';

    const conversation = {
      data: { id: 'conversation-1' },
      session: { sessionId: 'session-1' },
    };
    const conversationMap = new Map();
    conversationMap.values = mocks.conversationValues;
    const tabManager = {
      activeConversation: conversation,
      activeDescriptor: {
        kind: 'conversation',
        tabId: 'conversation:conversation-1',
        conversationId: 'conversation-1',
      },
      activeConversationId: 'conversation-1',
      activeTabId: 'conversation:conversation-1',
    };
    Object.defineProperties(tabManager, {
      entries: {
        get: () => {
          throw new Error('active session inspected every tab entry');
        },
      },
      resolvedTabs: {
        get: () => {
          throw new Error('active session resolved every tab');
        },
      },
      tabOrder: {
        get: () => {
          throw new Error('active session scanned tab order');
        },
      },
    });
    mocks.provisioned = {
      conversations: {
        conversations: conversationMap,
        hasAuthoritativeSnapshot: true,
      },
      taskView: {
        focusedRegion: 'main',
        setFocusedRegion: vi.fn(),
        tabManager,
      },
    };

    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  it('mounts the final session without collection scans or background reads', async () => {
    const { ConversationsPanel } = await import(
      '@renderer/features/tasks/conversations/conversations-panel'
    );
    await act(async () => root.render(createElement(ConversationsPanel)));

    expect(host.querySelector('[data-conversation-session]')).not.toBeNull();
    expect(
      host.querySelector('[data-pane-session-ids]')?.getAttribute('data-pane-session-ids')
    ).toBe('session-1');
    expect(mocks.conversationValues).not.toHaveBeenCalled();
    expect(mocks.archivedHook).not.toHaveBeenCalled();
    expect(mocks.historyActive).not.toHaveBeenCalled();

    await vi.waitFor(() => {
      expect(mocks.historyActive).toHaveBeenLastCalledWith(true);
    });
  });

  it('does not mount stale session chrome while the routed conversation is resolving', async () => {
    mocks.routeConversationId = 'conversation-2';
    const { ConversationsPanel } = await import(
      '@renderer/features/tasks/conversations/conversations-panel'
    );
    await act(async () => root.render(createElement(ConversationsPanel)));

    expect(host.textContent).toContain('opening');
    expect(host.querySelector('[data-conversation-session]')).toBeNull();
    expect(
      host.querySelector('[data-pane-session-ids]')?.getAttribute('data-pane-session-ids')
    ).toBe('');
    expect(mocks.historyActive).not.toHaveBeenCalled();

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(mocks.historyActive).not.toHaveBeenCalled();
  });
});
