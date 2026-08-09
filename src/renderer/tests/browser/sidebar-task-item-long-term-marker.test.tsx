import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  toggleTaskCollapsed: vi.fn(),
  getTaskDeliverySummaries: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@renderer/features/projects/stores/project-selectors', () => ({
  getProjectStore: () => ({ state: 'unregistered' }),
}));

vi.mock('@renderer/features/settings/use-app-settings-key', () => ({
  useAppSettingsKey: () => ({
    value: {
      taskAppearance: {
        standard: { titleStyle: 'regular', idleOpacity: 100, marker: 'none' },
        longTerm: { titleStyle: 'italic', idleOpacity: 70, marker: 'bookmark' },
        multiAgent: { marker: 'users' },
      },
    },
  }),
}));

vi.mock('@renderer/features/sidebar/task-sidebar-agent-status', () => ({
  TaskSidebarAgentStatus: () => null,
}));

vi.mock('@renderer/features/tasks/components/task-context-menu', () => ({
  TaskContextMenu: ({ children }: { children: ReactNode }) => children,
  TaskActionsMenu: () => null,
}));

vi.mock('@renderer/lib/ipc', () => ({
  rpc: {
    conversations: {
      getTaskDeliverySummaries: mocks.getTaskDeliverySummaries,
    },
  },
  events: {
    on: vi.fn(),
    off: vi.fn(),
    emit: vi.fn(),
  },
}));

vi.mock('@renderer/lib/ui/markdown-renderer', () => ({
  MarkdownRenderer: ({ content }: { content: string }) =>
    createElement('div', { 'data-testid': 'task-hover-summary' }, content),
}));

vi.mock('@renderer/features/tasks/components/use-task-menu-actions', () => ({
  useTaskMenuActions: () => ({
    onRename: vi.fn(),
    onArchiveQuick: vi.fn(),
    onCreateSubtask: vi.fn(),
  }),
}));

vi.mock('@renderer/features/tasks/stores/task-selectors', () => ({
  asProvisioned: () => undefined,
  getTaskManagerStore: () => ({
    archivingTaskIds: new Set<string>(),
    preloadTask: vi.fn(),
  }),
  getTaskStore: () => ({
    state: 'unregistered',
    data: {
      id: 'task-1',
      name: 'Long-term task',
      status: 'todo',
      isLongTerm: true,
      needsReview: false,
    },
    conversationStats: {},
  }),
  taskSessionStatusSummary: () => ({ primaryStatus: null }),
}));

vi.mock('@renderer/lib/components/pr-badge', () => ({
  PrBadge: () => null,
}));

vi.mock('@renderer/lib/layout/navigation-provider', () => ({
  useNavigate: () => ({ navigate: mocks.navigate }),
  useParams: () => ({ params: {} }),
}));

vi.mock('@renderer/lib/stores/app-state', () => ({
  appState: {
    history: { lastTaskTab: () => undefined },
    appTabs: { openTaskScope: () => false },
    sidePane: { pinTaskView: vi.fn() },
  },
  sidebarStore: {
    collapsedTaskIds: new Set<string>(),
    taskBranchDisplay: 'none',
    toggleTaskCollapsed: mocks.toggleTaskCollapsed,
    holdTaskReflow: vi.fn(),
    releaseTaskReflow: vi.fn(),
  },
}));

vi.mock('@renderer/features/sidebar/use-sidebar-hover-intent', () => ({
  useSidebarHoverIntent: () => ({
    schedule: vi.fn(),
    cancel: vi.fn(),
    runNow: vi.fn(),
  }),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('SidebarTaskItem long-term marker', () => {
  let host: HTMLDivElement;
  let root: Root;
  let queryClient: QueryClient;

  beforeEach(() => {
    mocks.navigate.mockClear();
    mocks.toggleTaskCollapsed.mockClear();
    mocks.getTaskDeliverySummaries.mockReset();
    mocks.getTaskDeliverySummaries.mockResolvedValue([]);
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  it('keeps the marker out of the root disclosure hit area', async () => {
    const { SidebarTaskItem } = await import('@renderer/features/sidebar/task-item');

    await act(async () => {
      root.render(
        createElement(
          QueryClientProvider,
          { client: queryClient },
          createElement(SidebarTaskItem, {
            projectId: 'project-1',
            taskId: 'task-1',
            childCount: 1,
          })
        )
      );
    });

    const marker = host.querySelector('[role="img"]');
    const disclosure = host.querySelector<HTMLButtonElement>(
      '[aria-label="sidebar.toggleSubtasks"]'
    );

    expect(marker?.classList.contains('pointer-events-none')).toBe(true);
    expect(disclosure).not.toBeNull();

    await act(async () => {
      disclosure?.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
    });

    expect(mocks.toggleTaskCollapsed).toHaveBeenCalledWith('task-1');
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it('opens a compact recent-progress preview after hover intent', async () => {
    mocks.getTaskDeliverySummaries.mockResolvedValue([
      {
        conversationId: 'conversation-1',
        taskId: 'task-1',
        taskName: 'Long-term task',
        conversationTitle: 'Implement hover preview',
        text: '已经完成侧栏任务悬浮预览。',
        timestamp: new Date().toISOString(),
      },
    ]);

    const { SidebarTaskItem } = await import('@renderer/features/sidebar/task-item');

    await act(async () => {
      root.render(
        createElement(
          QueryClientProvider,
          { client: queryClient },
          createElement(SidebarTaskItem, {
            projectId: 'project-1',
            taskId: 'task-1',
          })
        )
      );
    });

    const row = host.querySelector<HTMLElement>('[data-sidebar-task-id="task-1"]');
    expect(row).not.toBeNull();

    await act(async () => {
      await userEvent.hover(row!);
      await new Promise((resolve) => setTimeout(resolve, 450));
    });

    await vi.waitFor(() => {
      expect(document.body.querySelector('[data-sidebar-task-hover-preview]')).not.toBeNull();
    });
    expect(document.body.textContent).toContain('已经完成侧栏任务悬浮预览。');

    await act(async () => {
      await userEvent.unhover(row!);
      await new Promise((resolve) => setTimeout(resolve, 260));
    });

    await vi.waitFor(() => {
      expect(document.body.querySelector('[data-sidebar-task-hover-preview]')).toBeNull();
    });
  });
});
