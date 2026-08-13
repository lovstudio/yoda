import { act, createElement, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TaskMenuActions } from '@renderer/features/tasks/components/task-context-menu';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  archiveTask: vi.fn<(taskId: string, options?: { skipPreCommand?: boolean }) => Promise<void>>(),
  showModal: vi.fn(),
  task: {
    state: 'unprovisioned' as const,
    phase: 'idle' as const,
    data: {
      id: 'task-1',
      name: 'Task 1',
      isPinned: false,
      isFavorite: false,
      isLongTerm: false,
      needsReview: false,
    },
    conversationStats: {},
    setPinned: vi.fn(),
    setFavorite: vi.fn(),
    setLongTerm: vi.fn(),
    setNeedsReview: vi.fn<(needsReview: boolean) => Promise<void>>(),
    setSidebarWorkspaceId: vi.fn(),
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@shared/deep-links', () => ({ buildTaskDeepLink: vi.fn() }));
vi.mock('@shared/projects', () => ({ INTERNAL_PROJECT_ID: '__drafts__' }));
vi.mock('@renderer/app/open-new-task', () => ({ openNewTaskFromCurrentContext: vi.fn() }));
vi.mock('@renderer/features/projects/stores/project-selectors', () => ({
  getProjectStore: () => undefined,
  getRepositoryStore: () => undefined,
}));
vi.mock('@renderer/features/tasks/archive-task', () => ({
  useArchiveTask: () => ({ archiveTask: mocks.archiveTask }),
}));
vi.mock('@renderer/features/tasks/open-task-when-ready', () => ({
  openTaskWhenReady: vi.fn(),
}));
vi.mock('@renderer/features/tasks/components/task-context-menu', () => ({
  copyTaskLink: vi.fn(),
}));
vi.mock('@renderer/features/tasks/components/task-menu-session-info', () => ({
  buildTaskMenuSessionFields: () => ({}),
  getTaskMenuConversation: () => undefined,
  resolveTaskMenuSessionFields: vi.fn(),
  selectPreferredConversation: vi.fn(),
}));
vi.mock('@renderer/features/tasks/components/use-move-task-to-project', () => ({
  useMoveTaskToProject: () => vi.fn(),
}));
vi.mock('@renderer/features/tasks/split-view/split-view-store', () => ({
  splitViewStore: { add: vi.fn(), replace: vi.fn() },
}));
vi.mock('@renderer/features/tasks/stores/task', () => ({
  registeredTaskData: (task: { data: unknown }) => task.data,
}));
vi.mock('@renderer/features/tasks/stores/task-selectors', () => ({
  asProvisioned: () => undefined,
  getTaskManagerStore: () => undefined,
  getTaskStore: () => mocks.task,
  taskChildren: () => [],
}));
vi.mock('@renderer/features/tasks/tabs/tab-manager-store', () => ({ OVERVIEW_TAB_ID: 'overview' }));
vi.mock('@renderer/lib/ipc', () => ({ rpc: { conversations: {} } }));
vi.mock('@renderer/lib/layout/navigation-provider', () => ({
  useNavigate: () => ({ navigate: mocks.navigate }),
}));
vi.mock('@renderer/lib/modal/modal-provider', () => ({ useShowModal: () => mocks.showModal }));
vi.mock('@renderer/utils/logger', () => ({ log: { warn: vi.fn() } }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('useTaskMenuActions', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    mocks.navigate.mockReset();
    mocks.archiveTask.mockReset();
    mocks.showModal.mockReset();
    mocks.task.setNeedsReview.mockReset();
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  it('marks pending acceptance before immediately returning to home', async () => {
    const { useTaskMenuActions } = await import(
      '@renderer/features/tasks/components/use-task-menu-actions'
    );
    let resolveActions: (actions: TaskMenuActions | null) => void;
    const actionsReady = new Promise<TaskMenuActions | null>((resolve) => {
      resolveActions = resolve;
    });
    let resolveRequest: (() => void) | undefined;
    mocks.task.setNeedsReview.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveRequest = resolve;
        })
    );

    function Probe() {
      const actions = useTaskMenuActions('project-1', 'task-1');
      useEffect(() => {
        resolveActions(actions);
      }, [actions]);
      return null;
    }

    await act(async () => {
      root.render(createElement(Probe));
    });

    const actions = await actionsReady;
    expect(actions).not.toBeNull();

    await act(async () => {
      actions?.onMarkNeedsReview();
    });

    expect(mocks.task.setNeedsReview).toHaveBeenCalledWith(true);
    expect(mocks.navigate).toHaveBeenCalledWith('home');

    resolveRequest?.();
  });

  it('archives directly without opening configuration, then immediately returns home', async () => {
    const { useTaskMenuActions } = await import(
      '@renderer/features/tasks/components/use-task-menu-actions'
    );
    let resolveActions: (actions: TaskMenuActions | null) => void;
    const actionsReady = new Promise<TaskMenuActions | null>((resolve) => {
      resolveActions = resolve;
    });
    let resolveArchive: (() => void) | undefined;
    mocks.archiveTask.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveArchive = resolve;
        })
    );

    function Probe() {
      const actions = useTaskMenuActions('project-1', 'task-1');
      useEffect(() => {
        resolveActions(actions);
      }, [actions]);
      return null;
    }

    await act(async () => {
      root.render(createElement(Probe));
    });

    const actions = await actionsReady;
    expect(actions).not.toBeNull();
    expect(actions?.onArchive).toBe(actions?.onArchiveQuick);

    await act(async () => {
      actions?.onArchive();
    });

    expect(mocks.archiveTask).toHaveBeenCalledWith('task-1', { skipPreCommand: true });
    expect(mocks.showModal).not.toHaveBeenCalled();
    expect(mocks.navigate).toHaveBeenCalledWith('home');

    resolveArchive?.();
  });
});
