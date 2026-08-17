import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  archived: [] as unknown[],
  conversations: new Map<string, unknown>(),
  getRoomForTask: vi.fn(),
  showNewConversationModal: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@renderer/features/tasks/conversations/session-history-panel', () => ({
  DockedSessionHistory: () => null,
}));

vi.mock('@renderer/features/tasks/hooks/use-is-active-task', () => ({
  useIsActiveTask: () => true,
}));

vi.mock('@renderer/features/settings/use-app-settings-key', () => ({
  useAppSettingsKey: () => ({ isLoading: false }),
}));

vi.mock('@renderer/features/tasks/split-view/split-view-store', () => ({
  splitViewStore: { has: () => false },
}));

vi.mock('@renderer/features/agent-room/task-room-chat', () => ({
  TaskRoomChat: () => createElement('div', { 'data-task-room-chat': true }, 'group chat'),
}));

vi.mock('@renderer/features/tasks/task-view-context', () => ({
  useTaskViewContext: () => ({ projectId: 'project-1', taskId: 'task-1' }),
  useRequireProvisionedTask: () => provisioned,
}));

// A task with no session is routed to the task itself: no `tab` param at all.
vi.mock('@renderer/lib/layout/navigation-provider', () => ({
  useParams: () => ({ params: {} }),
}));

vi.mock('@renderer/lib/modal/modal-provider', () => ({
  useShowModal: () => mocks.showNewConversationModal,
}));

vi.mock('@renderer/lib/ipc', () => ({
  events: {},
  rpc: { teamRooms: { getRoomForTask: (...args: unknown[]) => mocks.getRoomForTask(...args) } },
}));

vi.mock('@renderer/lib/pty/pane-sizing-context', () => ({
  PaneSizingProvider: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('@renderer/features/tasks/conversations/conversation-session', () => ({
  ConversationSession: () => createElement('div', { 'data-conversation-session': true }),
  getResumeInitialSize: vi.fn(),
}));

vi.mock('@renderer/features/tasks/conversations/conversation-tree', () => ({
  ConversationTree: () => createElement('div', { 'data-conversation-tree': true }),
}));

vi.mock('@renderer/features/tasks/conversations/use-archived-conversations', () => ({
  useArchivedConversations: () => mocks.archived,
}));

vi.mock('@renderer/utils/logger', () => ({
  log: { level: 'info', debug: vi.fn() },
}));

const provisioned = {
  conversations: {
    get conversations() {
      return mocks.conversations;
    },
    hasAuthoritativeSnapshot: true,
    loadError: null,
    retryLoad: vi.fn(),
  },
  taskView: {
    focusedRegion: 'main',
    setFocusedRegion: vi.fn(),
    tabManager: {
      activeConversation: undefined,
      activeConversationId: null,
      activeDescriptor: undefined,
      activeTabId: undefined,
      entries: new Map(),
      openConversation: vi.fn(),
      tabOrder: [] as string[],
    },
  },
};

// A task IS its session, so a task holding no tab lands on its own session
// surface — never on a page in front of it.
describe('ConversationsPanel landing surface for a task with no session', () => {
  let host: HTMLDivElement;
  let root: Root;
  let queryClient: QueryClient;

  const render = async () => {
    const { ConversationsPanel } = await import(
      '@renderer/features/tasks/conversations/conversations-panel'
    );
    await act(async () =>
      root.render(
        createElement(
          QueryClientProvider,
          { client: queryClient },
          createElement(ConversationsPanel)
        )
      )
    );
  };

  beforeEach(() => {
    mocks.archived = [];
    mocks.conversations = new Map();
    mocks.getRoomForTask.mockReset().mockResolvedValue(null);
    mocks.showNewConversationModal.mockReset();
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    queryClient.clear();
    host.remove();
  });

  it('offers the session launcher in place, without any task page in front of it', async () => {
    await render();

    expect(host.querySelector('[data-conversations-panel-root]')).not.toBeNull();
    expect(host.textContent).toContain('tasks.conversations.emptyTitle');
    expect(host.querySelector('[data-conversation-session]')).toBeNull();

    const launcher = host.querySelector<HTMLButtonElement>('button');
    expect(launcher?.textContent).toContain('tasks.conversations.createConversation');

    await act(async () => launcher?.click());
    expect(mocks.showNewConversationModal).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 'project-1', taskId: 'task-1' })
    );
  });

  it('lands a team-room task on its group chat instead of the launcher', async () => {
    mocks.getRoomForTask.mockResolvedValue({ id: 'room-1' });

    await render();
    await vi.waitFor(() => {
      expect(host.querySelector('[data-task-room-chat]')).not.toBeNull();
    });
    expect(host.textContent).not.toContain('tasks.conversations.emptyTitle');
  });

  it('lists existing sessions once the task has archived ones to restore', async () => {
    mocks.archived = [{ id: 'conversation-archived' }];

    await render();

    expect(host.textContent).not.toContain('tasks.conversations.emptyTitle');
    expect(host.querySelector('[data-conversation-tree]')).not.toBeNull();
  });
});
