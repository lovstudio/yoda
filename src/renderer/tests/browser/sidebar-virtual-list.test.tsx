import { runInAction } from 'mobx';
import { act, createElement, type RefObject } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SidebarPinnedTaskList } from '@renderer/features/sidebar/pinned-task-list';
import type { PinnedSidebarEntry, SidebarRow } from '@renderer/features/sidebar/sidebar-store';
import { SidebarVirtualList } from '@renderer/features/sidebar/sidebar-virtual-list';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  sidebarStore: null as unknown as {
    sidebarRows: SidebarRow[];
    pinnedSidebarEntries: PinnedSidebarEntry[];
    pinnedCollapsed: boolean;
    taskGroupVisibleLimit: number;
    taskGroupBy: 'project';
    holdTaskReflow: ReturnType<typeof vi.fn>;
    releaseTaskReflow: ReturnType<typeof vi.fn>;
    togglePinnedCollapsed: ReturnType<typeof vi.fn>;
  },
}));

vi.mock('@renderer/lib/stores/app-state', async () => {
  const { observable } = (await vi.importActual('mobx')) as {
    observable: <T extends object>(value: T) => T;
  };
  const sidebarStore = observable({
    sidebarRows: [] as SidebarRow[],
    pinnedSidebarEntries: [] as PinnedSidebarEntry[],
    pinnedCollapsed: false,
    taskGroupVisibleLimit: 5,
    taskGroupBy: 'project' as const,
    holdTaskReflow: vi.fn(),
    releaseTaskReflow: vi.fn(),
    togglePinnedCollapsed: vi.fn(),
  });
  mocks.sidebarStore = sidebarStore;
  return { sidebarStore };
});

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@renderer/lib/layout/navigation-provider', () => ({
  useParams: () => ({ params: {} }),
  useWorkspaceSlots: () => ({ currentView: 'home' }),
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
vi.mock('@renderer/lib/hooks/use-toast', () => ({ toast: vi.fn() }));
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
  SidebarTaskItem: ({ taskId }: { taskId: string }) =>
    createElement('div', { 'data-testid': `task-${taskId}`, style: { height: '48px' } }, taskId),
}));
vi.mock('@renderer/features/sidebar/sidebar-task-group', () => ({
  getSidebarTaskGroupDisclosure: (rows: SidebarRow[]) => ({ visibleItems: rows, hiddenCount: 0 }),
  hiddenSidebarTaskGroupItemsContain: () => false,
}));
vi.mock('@renderer/features/sidebar/sidebar-task-group-toggle', () => ({
  SidebarTaskGroupToggle: () => null,
}));

const projectRow: SidebarRow = { kind: 'project', projectId: 'project-1' };
const taskRow: SidebarRow = {
  kind: 'task',
  projectId: 'project-1',
  taskId: 'task-1',
};
const pinnedProjectEntry: PinnedSidebarEntry = { kind: 'project', projectId: 'project-1' };
const pinnedTaskEntry: PinnedSidebarEntry = {
  kind: 'project-task',
  projectId: 'project-1',
  taskId: 'task-1',
};

describe('SidebarVirtualList', () => {
  let host: HTMLDivElement;
  let scrollRoot: HTMLDivElement;
  let root: Root;
  let scrollElementRef: RefObject<HTMLDivElement | null>;
  let fixedRegionRef: RefObject<HTMLDivElement | null>;

  beforeEach(async () => {
    vi.clearAllMocks();
    host = document.createElement('div');
    host.style.width = '280px';
    host.style.height = '120px';
    scrollRoot = document.createElement('div');
    scrollRoot.style.height = '120px';
    scrollRoot.style.overflowY = 'auto';
    host.appendChild(scrollRoot);
    document.body.appendChild(host);
    root = createRoot(scrollRoot);
    scrollElementRef = { current: scrollRoot };
    fixedRegionRef = { current: null };
    runInAction(() => {
      mocks.sidebarStore.sidebarRows = [projectRow];
    });
    function Harness() {
      return createElement(
        'div',
        null,
        createElement('div', { ref: fixedRegionRef, style: { height: '40px' } }),
        createElement(SidebarVirtualList, { scrollElementRef, fixedRegionRef })
      );
    }
    await act(async () => {
      root.render(createElement(Harness));
    });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
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

  it('renders a task added under an expanded pinned project without another interaction', async () => {
    runInAction(() => {
      mocks.sidebarStore.sidebarRows = [];
      mocks.sidebarStore.pinnedSidebarEntries = [pinnedProjectEntry];
    });
    await act(async () => {
      root.render(
        createElement(SidebarPinnedTaskList, {
          scrollElementRef: { current: scrollRoot },
        })
      );
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
});
