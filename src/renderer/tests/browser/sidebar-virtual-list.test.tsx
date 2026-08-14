import { runInAction } from 'mobx';
import { act, createElement, useState, type RefObject } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SidebarPinnedTaskList } from '@renderer/features/sidebar/pinned-task-list';
import { SidebarDndProvider } from '@renderer/features/sidebar/sidebar-dnd-context';
import { sidebarGroupId, type SidebarGroupKey } from '@renderer/features/sidebar/sidebar-group';
import { type PinnedSidebarEntry, type SidebarRow } from '@renderer/features/sidebar/sidebar-store';
import { SidebarVirtualList } from '@renderer/features/sidebar/sidebar-virtual-list';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  sidebarStore: null as unknown as {
    sidebarRows: SidebarRow[];
    pinnedSidebarEntries: PinnedSidebarEntry[];
    pinnedCollapsed: boolean;
    projectsCollapsed: boolean;
    taskPriorityMode: boolean;
    collapsedTaskGroupIds: Set<string>;
    sidebarArchivedTaskLoadState: 'idle' | 'loading' | 'error';
    taskGroupVisibleLimit: number;
    taskGroupBy: 'project';
    holdTaskReflow: ReturnType<typeof vi.fn>;
    releaseTaskReflow: ReturnType<typeof vi.fn>;
    togglePinnedCollapsed: ReturnType<typeof vi.fn>;
    toggleTaskGroupCollapsed: ReturnType<typeof vi.fn>;
    ensureTaskExpanded: ReturnType<typeof vi.fn>;
    setChildTaskOrder: ReturnType<typeof vi.fn>;
    setTaskOrder: ReturnType<typeof vi.fn>;
    setProjectOrder: ReturnType<typeof vi.fn>;
    loadMoreSidebarArchivedTasks: ReturnType<typeof vi.fn>;
  },
  staleVirtualItemKey: null as string | null,
  virtualizerOptions: [] as object[],
  loadMoreSidebarArchivedTasks: vi.fn<(limit: number) => Promise<number>>(async () => 0),
  toast: vi.fn(),
}));

type ReactVirtualizerModule = {
  useVirtualizer: (options: object) => {
    getVirtualItems: () => Array<{ index: number; key: string | number }>;
  };
};

vi.mock('@tanstack/react-virtual', async (importOriginal) => {
  const actual = await importOriginal<ReactVirtualizerModule>();
  return {
    ...actual,
    useVirtualizer: (options: object) => {
      mocks.virtualizerOptions.push(options);
      const virtualizer = actual.useVirtualizer(options);
      if (!mocks.staleVirtualItemKey) return virtualizer;

      // Model the one render where a virtualizer has retained the previous
      // item's key while the observable row model has already reordered.
      const staleKey = mocks.staleVirtualItemKey;
      const proxy = Object.create(virtualizer) as typeof virtualizer;
      proxy.getVirtualItems = () =>
        virtualizer
          .getVirtualItems()
          .map((item, index) => (index === 0 ? { ...item, key: staleKey } : item));
      return proxy;
    },
  };
});

vi.mock('@renderer/lib/stores/app-state', async () => {
  const { observable } = (await vi.importActual('mobx')) as {
    observable: {
      <T extends object>(value: T): T;
      set<T>(): Set<T>;
    };
  };
  const sidebarStore = observable({
    sidebarRows: [] as SidebarRow[],
    pinnedSidebarEntries: [] as PinnedSidebarEntry[],
    pinnedCollapsed: false,
    projectsCollapsed: false,
    taskPriorityMode: false,
    collapsedTaskGroupIds: observable.set<string>(),
    sidebarArchivedTaskLoadState: 'idle' as const,
    taskGroupVisibleLimit: 5,
    taskGroupBy: 'project' as const,
    holdTaskReflow: vi.fn(),
    releaseTaskReflow: vi.fn(),
    togglePinnedCollapsed: vi.fn(),
    toggleTaskGroupCollapsed: vi.fn((group: SidebarGroupKey) => {
      const groupId = sidebarGroupId(group);
      if (sidebarStore.collapsedTaskGroupIds.has(groupId)) {
        sidebarStore.collapsedTaskGroupIds.delete(groupId);
      } else {
        sidebarStore.collapsedTaskGroupIds.add(groupId);
      }
    }),
    ensureTaskExpanded: vi.fn(),
    setChildTaskOrder: vi.fn(),
    setTaskOrder: vi.fn(),
    setProjectOrder: vi.fn(),
    loadMoreSidebarArchivedTasks: mocks.loadMoreSidebarArchivedTasks,
  });
  mocks.sidebarStore = sidebarStore;
  return {
    sidebarStore,
    appState: {
      sidebar: sidebarStore,
      sidePane: { pinTaskView: vi.fn() },
    },
  };
});

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@renderer/lib/layout/navigation-provider', () => ({
  useNavigate: () => ({ navigate: vi.fn() }),
  useParams: () => ({ params: {} }),
  useWorkspaceSlots: () => ({ currentView: 'home' }),
}));
vi.mock('@renderer/features/projects/open-project-archived-tasks', () => ({
  openProjectArchivedTasks: vi.fn(),
}));
vi.mock('@renderer/features/agent-room/team-room-queries', () => ({
  teamRoomTaskKey: (projectId: string, taskId: string) => `${projectId}:${taskId}`,
  useTeamRoomTaskKeys: () => new Set<string>(),
}));
vi.mock('@renderer/features/tasks/components/use-move-task-to-project', () => ({
  useMoveTaskToProject: () => vi.fn(),
}));
vi.mock('@renderer/features/tasks/stores/task-selectors', () => ({
  getRegisteredTaskData: () => undefined,
  getTaskStore: () => undefined,
}));
vi.mock('@renderer/features/tasks/conversations/conversation-transfer', () => ({
  canMoveConversationToTask: () => false,
  conversationTransferFromPayload: () => null,
}));
vi.mock('@renderer/features/tasks/conversations/move-conversation-to-task', () => ({
  moveConversationToTask: vi.fn(),
}));
vi.mock('@renderer/lib/hooks/use-toast', () => ({
  toast: mocks.toast,
  useToast: () => ({ toast: mocks.toast }),
}));
vi.mock('@renderer/app/tab-drag', () => ({
  useTabDropZone: () => ({ dropRef: () => {}, isOver: false }),
}));
vi.mock('@renderer/features/sidebar/project-item', () => ({
  SidebarProjectItem: ({ projectId }: { projectId: string }) =>
    createElement(
      'div',
      { 'data-testid': `project-${projectId}`, style: { height: '32px' } },
      projectId
    ),
}));
vi.mock('@renderer/features/sidebar/task-item', () => ({
  SidebarTaskItem: ({ taskId }: { taskId: string }) => {
    // SidebarTaskItem owns popover/menu state. Hold on to the mounting task ID
    // here so the test detects React reusing that state for another row.
    const [mountedTaskId] = useState(taskId);
    return createElement(
      'div',
      { 'data-testid': `task-${mountedTaskId}`, style: { height: '48px' } },
      mountedTaskId
    );
  },
}));
vi.mock('@renderer/features/sidebar/sidebar-task-group-toggle', () => ({
  SidebarTaskGroupToggle: ({
    hiddenCount,
    loading,
    onToggle,
  }: {
    hiddenCount: number;
    loading?: boolean;
    onToggle: () => void;
  }) =>
    createElement(
      'button',
      { 'data-testid': 'show-more-tasks', disabled: loading, onClick: onToggle },
      String(hiddenCount)
    ),
}));
vi.mock('@renderer/features/sidebar/projects-group-label', () => ({
  ProjectsGroupLabel: () => createElement('div', { style: { height: '32px' } }, 'projects'),
}));

const projectRow: SidebarRow = { kind: 'project', projectId: 'project-1' };
const taskRow: SidebarRow = {
  kind: 'task',
  projectId: 'project-1',
  taskId: 'task-1',
};
const replacementTaskRow: SidebarRow = {
  kind: 'task',
  projectId: 'project-1',
  taskId: 'task-2',
};
const pinnedProjectEntry: PinnedSidebarEntry = { kind: 'project', projectId: 'project-1' };
const pinnedTaskEntry: PinnedSidebarEntry = {
  kind: 'project-task',
  projectId: 'project-1',
  taskId: 'task-1',
};
const replacementPinnedTaskEntry: PinnedSidebarEntry = {
  kind: 'project-task',
  projectId: 'project-1',
  taskId: 'task-2',
};

describe('SidebarVirtualList', () => {
  let host: HTMLDivElement;
  let scrollRoot: HTMLDivElement;
  let root: Root;
  let scrollElementRef: RefObject<HTMLDivElement | null>;
  let utilityStyles: HTMLStyleElement;

  beforeEach(async () => {
    vi.clearAllMocks();
    host = document.createElement('div');
    host.style.width = '280px';
    host.style.height = '120px';
    scrollRoot = document.createElement('div');
    scrollRoot.style.height = '120px';
    // SidebarContent is a vertical flex scroller. The virtual list must keep
    // its full measured height instead of flex-shrinking and clipping itself.
    scrollRoot.style.display = 'flex';
    scrollRoot.style.flexDirection = 'column';
    scrollRoot.style.overflowY = 'auto';
    utilityStyles = document.createElement('style');
    utilityStyles.textContent =
      '.shrink-0 { flex-shrink: 0; } .overflow-hidden { overflow: hidden; }';
    document.head.appendChild(utilityStyles);
    host.appendChild(scrollRoot);
    document.body.appendChild(host);
    root = createRoot(scrollRoot);
    scrollElementRef = { current: scrollRoot };
    runInAction(() => {
      mocks.sidebarStore.sidebarRows = [projectRow];
      mocks.sidebarStore.pinnedSidebarEntries = [];
      mocks.sidebarStore.pinnedCollapsed = false;
      mocks.sidebarStore.projectsCollapsed = false;
      mocks.sidebarStore.taskPriorityMode = false;
      mocks.sidebarStore.collapsedTaskGroupIds.clear();
      mocks.sidebarStore.sidebarArchivedTaskLoadState = 'idle';
      mocks.loadMoreSidebarArchivedTasks.mockReset().mockResolvedValue(0);
      mocks.staleVirtualItemKey = null;
      mocks.virtualizerOptions = [];
    });
    function Harness() {
      return createElement(
        SidebarDndProvider,
        null,
        createElement(SidebarVirtualList, { scrollElementRef })
      );
    }
    await act(async () => {
      root.render(createElement(Harness));
    });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    utilityStyles.remove();
    host.remove();
  });

  it('renders a task added after its expanded project row without another interaction', async () => {
    runInAction(() => {
      mocks.sidebarStore.sidebarRows = [projectRow, taskRow];
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(document.querySelector('[data-testid="project-project-1"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="task-task-1"]')).not.toBeNull();
  });

  it('hides the pinned section while priority mode owns all sidebar tasks', async () => {
    runInAction(() => {
      mocks.sidebarStore.taskPriorityMode = true;
      mocks.sidebarStore.pinnedSidebarEntries = [pinnedTaskEntry];
      mocks.sidebarStore.sidebarRows = [taskRow];
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(document.body.textContent).not.toContain('sidebar.pinned');
    expect(document.querySelector('[data-testid="task-task-1"]')).not.toBeNull();
  });

  it('collapses and expands task groups from the group header', async () => {
    const workingGroup: SidebarRow = {
      kind: 'group',
      group: { kind: 'priority', priority: 'working', count: 1 },
    };
    runInAction(() => {
      mocks.sidebarStore.taskPriorityMode = true;
      mocks.sidebarStore.sidebarRows = [workingGroup, taskRow];
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const groupButton = document.querySelector<HTMLButtonElement>(
      '[data-sidebar-group-id="priority:working"] button'
    );
    expect(groupButton?.getAttribute('aria-expanded')).toBe('true');
    expect(document.querySelector('[data-testid="task-task-1"]')).not.toBeNull();

    await act(async () => {
      groupButton?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(groupButton?.getAttribute('aria-expanded')).toBe('false');
    expect(document.querySelector('[data-testid="task-task-1"]')).toBeNull();

    await act(async () => {
      groupButton?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(groupButton?.getAttribute('aria-expanded')).toBe('true');
    expect(document.querySelector('[data-testid="task-task-1"]')).not.toBeNull();
  });

  it('collapses every project and task row inside a type group', async () => {
    const localGroup: SidebarRow = {
      kind: 'group',
      group: { kind: 'type', type: 'local' },
    };
    runInAction(() => {
      mocks.sidebarStore.sidebarRows = [localGroup, projectRow, taskRow];
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const groupButton = document.querySelector<HTMLButtonElement>(
      '[data-sidebar-group-id="type:local"] button'
    );
    expect(document.querySelector('[data-testid="project-project-1"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="task-task-1"]')).not.toBeNull();

    await act(async () => {
      groupButton?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(document.querySelector('[data-testid="project-project-1"]')).toBeNull();
    expect(document.querySelector('[data-testid="task-task-1"]')).toBeNull();
  });

  it('reveals ten additional rows per group click', async () => {
    const taskRows: SidebarRow[] = Array.from({ length: 28 }, (_, index) => ({
      kind: 'task',
      projectId: 'project-1',
      taskId: `task-${index + 1}`,
    }));
    runInAction(() => {
      mocks.sidebarStore.sidebarRows = [projectRow, ...taskRows];
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(document.querySelectorAll('[data-testid^="task-"]')).toHaveLength(5);

    await act(async () => {
      document.querySelector<HTMLElement>('[data-testid="show-more-tasks"]')?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(document.querySelectorAll('[data-testid^="task-"]')).toHaveLength(15);
    expect(document.querySelector('[data-testid="show-more-tasks"]')?.textContent).toBe('13');
  });

  it('hydrates archived priority rows ten at a time', async () => {
    const archivedGroup: SidebarRow = {
      kind: 'group',
      group: { kind: 'priority', priority: 'archived', count: 25 },
    };
    let loadedCount = 0;
    mocks.loadMoreSidebarArchivedTasks.mockImplementation(async (limit: number) => {
      const count = Math.min(limit, 25 - loadedCount);
      loadedCount += count;
      runInAction(() => {
        mocks.sidebarStore.sidebarRows = [
          archivedGroup,
          ...Array.from(
            { length: loadedCount },
            (_, index): SidebarRow => ({
              kind: 'task',
              projectId: 'project-1',
              taskId: `archived-${index + 1}`,
              showProjectTag: true,
            })
          ),
        ];
      });
      return count;
    });
    runInAction(() => {
      mocks.sidebarStore.taskPriorityMode = true;
      mocks.sidebarStore.sidebarRows = [archivedGroup];
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(document.querySelectorAll('[data-testid^="task-"]')).toHaveLength(0);
    await act(async () => {
      document.querySelector<HTMLElement>('[data-testid="show-more-tasks"]')?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(mocks.loadMoreSidebarArchivedTasks).toHaveBeenCalledWith(10);
    expect(document.querySelectorAll('[data-testid^="task-"]')).toHaveLength(10);
  });

  it('shows copyable diagnostics when archived priority rows fail to load', async () => {
    const archivedGroup: SidebarRow = {
      kind: 'group',
      group: { kind: 'priority', priority: 'archived', count: 25 },
    };
    const error = new Error("No handler registered for 'tasks.getArchivedTasksPage'");
    mocks.loadMoreSidebarArchivedTasks.mockRejectedValue(error);
    runInAction(() => {
      mocks.sidebarStore.taskPriorityMode = true;
      mocks.sidebarStore.sidebarRows = [archivedGroup];
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      document.querySelector<HTMLElement>('[data-testid="show-more-tasks"]')?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(mocks.toast).toHaveBeenCalledWith({
      title: 'sidebar.loadMoreArchivedTasksFailed',
      description: 'sidebar.loadMoreArchivedTasksFailedDescription',
      variant: 'destructive',
      debugInfo: {
        error: error.message,
        groupId: 'direct-tasks::group::priority::archived',
        limit: 10,
      },
    });
  });

  it('flushes shared scroll-root virtual ranges synchronously', () => {
    expect(mocks.virtualizerOptions.length).toBeGreaterThan(0);
    expect(mocks.virtualizerOptions).toEqual(
      expect.arrayContaining([expect.objectContaining({ useFlushSync: true })])
    );
  });

  it('does not reuse a task row while a stale virtual item key catches up to a reordered row', async () => {
    runInAction(() => {
      mocks.sidebarStore.sidebarRows = [taskRow];
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(document.querySelector('[data-testid="task-task-1"]')).not.toBeNull();

    runInAction(() => {
      // A task opened from an older list position can surface at this visible
      // index before the virtualizer's own snapshot updates.
      mocks.staleVirtualItemKey = 'task::project-1::task-1';
      mocks.sidebarStore.sidebarRows = [replacementTaskRow];
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(document.querySelector('[data-testid="task-task-1"]')).toBeNull();
    expect(document.querySelector('[data-testid="task-task-2"]')).not.toBeNull();
  });

  it('renders a task added under an expanded pinned project without another interaction', async () => {
    runInAction(() => {
      mocks.sidebarStore.sidebarRows = [];
      mocks.sidebarStore.pinnedSidebarEntries = [pinnedProjectEntry];
    });
    await act(async () => {
      root.render(createElement(SidebarDndProvider, null, createElement(SidebarPinnedTaskList)));
    });

    runInAction(() => {
      mocks.sidebarStore.pinnedSidebarEntries = [pinnedProjectEntry, pinnedTaskEntry];
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(document.querySelector('[data-testid="project-project-1"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="task-task-1"]')).not.toBeNull();
  });

  it('does not reuse a pinned task row when the row model changes', async () => {
    runInAction(() => {
      mocks.sidebarStore.sidebarRows = [];
      mocks.sidebarStore.pinnedSidebarEntries = [pinnedTaskEntry];
    });
    await act(async () => {
      root.render(createElement(SidebarDndProvider, null, createElement(SidebarPinnedTaskList)));
    });
    expect(document.querySelector('[data-testid="task-task-1"]')).not.toBeNull();
    expect(
      document.querySelector('[data-sidebar-dnd-id="task::project-1::task-1"]')
    ).not.toBeNull();

    runInAction(() => {
      mocks.sidebarStore.pinnedSidebarEntries = [replacementPinnedTaskEntry];
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(document.querySelector('[data-testid="task-task-1"]')).toBeNull();
    expect(document.querySelector('[data-testid="task-task-2"]')).not.toBeNull();
  });

  it('keeps one virtual coordinate system covered while crossing pinned rows', async () => {
    const pinnedEntries: PinnedSidebarEntry[] = Array.from({ length: 8 }, (_, index) => ({
      kind: 'project-task',
      projectId: `pinned-project-${index}`,
      taskId: `pinned-task-${index}`,
    }));
    const projectRows: SidebarRow[] = Array.from({ length: 40 }, (_, index) => ({
      kind: 'project',
      projectId: `project-${index}`,
    }));

    runInAction(() => {
      mocks.sidebarStore.pinnedSidebarEntries = pinnedEntries;
      mocks.sidebarStore.sidebarRows = projectRows;
      mocks.staleVirtualItemKey = null;
    });
    await act(async () => {
      root.render(
        createElement(
          SidebarDndProvider,
          null,
          createElement(SidebarVirtualList, { scrollElementRef })
        )
      );
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    await act(async () => {
      scrollRoot.scrollTo({ top: 240, behavior: 'instant' });
      await new Promise((resolve) => setTimeout(resolve, 100));
    });

    const rootRect = scrollRoot.getBoundingClientRect();
    const visibleRows = Array.from(
      document.querySelectorAll<HTMLElement>('[data-testid^="project-"], [data-testid^="task-"]')
    )
      .map((element) => ({ element, rect: element.getBoundingClientRect() }))
      .filter(({ rect }) => rect.bottom > rootRect.top && rect.top < rootRect.bottom);

    expect(scrollRoot.scrollHeight).toBeGreaterThan(scrollRoot.clientHeight);
    expect(visibleRows.length).toBeGreaterThan(0);
    expect(Math.min(...visibleRows.map(({ rect }) => rect.top))).toBeLessThanOrEqual(
      // The projects section header can occupy one 32px row at the viewport
      // edge; the assertion protects against the former multi-row blank gap.
      rootRect.top + 40
    );
    expect(mocks.virtualizerOptions.length).toBeGreaterThan(0);
    expect(mocks.virtualizerOptions.every((options) => !('scrollMargin' in options))).toBe(true);
  });

  it('clears the sidebar drag state when the window loses focus', async () => {
    runInAction(() => {
      mocks.sidebarStore.sidebarRows = [projectRow, taskRow];
      mocks.sidebarStore.pinnedSidebarEntries = [pinnedTaskEntry];
    });
    await act(async () => {
      root.render(
        createElement(
          SidebarDndProvider,
          null,
          createElement(
            'div',
            null,
            createElement(SidebarPinnedTaskList),
            createElement(SidebarVirtualList, { scrollElementRef })
          )
        )
      );
    });

    const source = document.querySelector<HTMLElement>(
      '[data-sidebar-dnd-id="task::project-1::task-1"]'
    );
    expect(source).not.toBeNull();
    expect(source?.getAttribute('role')).toBe('button');

    await act(async () => {
      source?.dispatchEvent(
        new PointerEvent('pointerdown', {
          bubbles: true,
          button: 0,
          isPrimary: true,
          pointerId: 1,
          clientX: 10,
          clientY: 10,
        })
      );
      document.dispatchEvent(
        new PointerEvent('pointermove', {
          bubbles: true,
          isPrimary: true,
          pointerId: 1,
          clientX: 24,
          clientY: 24,
        })
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(source?.getAttribute('aria-pressed')).toBe('true');

    await act(async () => {
      window.dispatchEvent(new Event('blur'));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(document.querySelector('[data-index]')).not.toBeNull();

    await act(async () => {
      document.dispatchEvent(
        new PointerEvent('pointerup', {
          bubbles: true,
          isPrimary: true,
          pointerId: 1,
          clientX: 24,
          clientY: 24,
        })
      );
    });
  });
});
