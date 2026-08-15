import {
  act,
  createElement,
  type ButtonHTMLAttributes,
  type ReactElement,
  type ReactNode,
} from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { QuickAction } from '@shared/project-settings';
import type { TaskMenuActions } from '@renderer/features/tasks/components/task-context-menu';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@renderer/features/workspaces/workspace-assign-submenu', async () => {
  const { createElement: create, Fragment } = await import('react');
  const submenu = ({ showSeparator = true }: { showSeparator?: boolean }) =>
    create(
      Fragment,
      null,
      showSeparator ? create('hr') : null,
      create('button', null, 'workspaces.moveToWorkspace')
    );

  return {
    WorkspaceAssignContextSubmenu: submenu,
    WorkspaceAssignDropdownSubmenu: submenu,
  };
});

vi.mock('@renderer/features/tasks/components/move-to-project-submenu', async () => {
  const { createElement: create, Fragment } = await import('react');
  const submenu = ({ showSeparator = true }: { showSeparator?: boolean }) =>
    create(
      Fragment,
      null,
      showSeparator ? create('hr') : null,
      create('button', null, 'tasks.context.moveToProject')
    );

  return {
    MoveToProjectContextSubmenu: submenu,
    MoveToProjectDropdownSubmenu: submenu,
  };
});

vi.mock('@renderer/features/tasks/components/task-project-submenu', async () => {
  const { createElement: create, Fragment } = await import('react');
  const submenu = () =>
    create(Fragment, null, create('hr'), create('button', null, 'tasks.context.projectMenu'));

  return {
    TaskProjectContextSubmenu: submenu,
    TaskProjectDropdownSubmenu: submenu,
  };
});

vi.mock('@renderer/lib/hooks/use-toast', () => ({ toast: vi.fn() }));
vi.mock('@renderer/lib/ipc', () => ({ rpc: {} }));

vi.mock('@renderer/lib/ui/context-menu', async () => {
  const { createElement: create } = await import('react');
  const container =
    (slot: string) =>
    ({ children }: { children?: ReactNode }) =>
      create('div', { 'data-slot': slot }, children);
  const item = ({
    children,
    variant: _variant,
    ...props
  }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: string }) =>
    create('button', props, children);

  return {
    ContextMenu: container('context-menu'),
    ContextMenuContent: container('context-menu-content'),
    ContextMenuItem: item,
    ContextMenuSeparator: () => create('hr'),
    ContextMenuSub: container('context-menu-sub'),
    ContextMenuSubContent: container('context-menu-sub-content'),
    ContextMenuSubTrigger: container('context-menu-sub-trigger'),
    ContextMenuTrigger: container('context-menu-trigger'),
  };
});

vi.mock('@renderer/lib/ui/dropdown-menu', async () => {
  const { createElement: create } = await import('react');
  const container =
    (slot: string) =>
    ({ children }: { children?: ReactNode }) =>
      create('div', { 'data-slot': slot }, children);
  const item = ({
    children,
    variant: _variant,
    ...props
  }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: string }) =>
    create('button', props, children);

  return {
    DropdownMenu: container('dropdown-menu'),
    DropdownMenuContent: container('dropdown-menu-content'),
    DropdownMenuItem: item,
    DropdownMenuSeparator: () => create('hr'),
    DropdownMenuSub: container('dropdown-menu-sub'),
    DropdownMenuSubContent: container('dropdown-menu-sub-content'),
    DropdownMenuSubTrigger: container('dropdown-menu-sub-trigger'),
    DropdownMenuTrigger: ({ render }: { render: ReactElement }) => render,
  };
});

function taskMenuActions(overrides: Partial<TaskMenuActions> = {}): TaskMenuActions {
  return {
    isPinned: false,
    canPin: false,
    isFavorite: false,
    canFavorite: false,
    isLongTerm: false,
    canMarkLongTerm: false,
    isArchived: false,
    needsReview: false,
    canMarkReview: false,
    onPin: vi.fn(),
    onUnpin: vi.fn(),
    onFavorite: vi.fn(),
    onUnfavorite: vi.fn(),
    onMarkLongTerm: vi.fn(),
    onUnmarkLongTerm: vi.fn(),
    onMarkNeedsReview: vi.fn(),
    onUnmarkNeedsReview: vi.fn(),
    onRename: vi.fn(),
    onArchiveQuick: vi.fn(),
    onArchive: vi.fn(),
    onArchiveWithSkill: vi.fn(),
    onRestartSession: vi.fn(),
    ...overrides,
  };
}

function menuGroups(host: HTMLElement): string[][] {
  const groups: string[][] = [[]];

  for (const child of host.children) {
    if (child.tagName === 'HR') {
      groups.push([]);
      continue;
    }
    groups.at(-1)?.push(child.textContent?.trim() ?? '');
  }

  return groups;
}

describe('TaskContextMenuItems grouping', () => {
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

  it('groups the wind-down markers with archive in lifecycle order', async () => {
    const { TaskContextMenuItems } = await import(
      '@renderer/features/tasks/components/task-context-menu'
    );

    await act(async () => {
      root.render(
        createElement(
          TaskContextMenuItems,
          taskMenuActions({
            projectId: 'project-1',
            taskId: 'task-1',
            taskName: 'Task 1',
            canPin: true,
            canFavorite: true,
            canMarkLongTerm: true,
            canMarkReview: true,
            onOpenDetails: vi.fn(),
            onOpenBeside: vi.fn(),
            onTileCandidates: vi.fn(),
            onReconnect: vi.fn(),
            onCreateSubtask: vi.fn(),
            onCreateSubtaskAndRun: vi.fn(),
            onSetParent: vi.fn(),
            onCreateParent: vi.fn(),
            onCopyYodaLink: vi.fn(),
            onMoveToProject: vi.fn(),
            onAssignWorkspace: vi.fn(),
          })
        )
      );
    });

    expect(menuGroups(host)).toEqual([
      [
        'tasks.context.openDetails',
        'tasks.context.openBeside',
        'tasks.context.reopenTask',
        'tasks.context.tileCandidates',
        'sidebar.reconnect',
      ],
      ['common.rename', 'tasks.context.pinTask', 'tasks.context.favoriteTask'],
      [
        'tasks.context.markForReview',
        'tasks.context.markLongTerm',
        'tasks.context.archiveDirect',
        'tasks.context.archiveOptions',
      ],
      [
        'tasks.context.createSubtask',
        'tasks.context.createSubtaskAndRun',
        'tasks.context.setParent',
        'tasks.context.createParent',
      ],
      ['tasks.context.copyTaskId', 'tasks.context.copyTaskBasicInfo', 'tasks.context.copyYodaLink'],
      ['tasks.context.projectMenu'],
      ['tasks.context.moveToProject', 'workspaces.moveToWorkspace'],
    ]);
  });

  it('keeps restore in the archive group before movement', async () => {
    const { TaskContextMenuItems } = await import(
      '@renderer/features/tasks/components/task-context-menu'
    );

    await act(async () => {
      root.render(
        createElement(
          TaskContextMenuItems,
          taskMenuActions({
            isArchived: true,
            onArchiveWithSkill: undefined,
            onRestore: vi.fn(),
            projectId: 'project-1',
            onMoveToProject: vi.fn(),
          })
        )
      );
    });

    expect(menuGroups(host).slice(-3)).toEqual([
      ['projects.tasks.restore'],
      ['tasks.context.projectMenu'],
      ['tasks.context.moveToProject'],
    ]);
  });

  it('keeps favorite available for archived tasks because it is independent of status', async () => {
    const { TaskContextMenuItems } = await import(
      '@renderer/features/tasks/components/task-context-menu'
    );

    await act(async () => {
      root.render(
        createElement(
          TaskContextMenuItems,
          taskMenuActions({
            isArchived: true,
            isFavorite: true,
            canFavorite: true,
            onArchiveWithSkill: undefined,
            onRestore: vi.fn(),
          })
        )
      );
    });

    expect(host.textContent).toContain('tasks.context.unfavoriteTask');
    expect(host.textContent).not.toContain('tasks.context.favoriteTask');
  });

  it.each(['context', 'dropdown'] as const)(
    'toggles favorite from the shared %s menu',
    async (surface) => {
      const { TaskActionsMenu, TaskContextMenu } = await import(
        '@renderer/features/tasks/components/task-context-menu'
      );
      const onFavorite = vi.fn();
      const onUnfavorite = vi.fn();
      const renderMenu = async (isFavorite: boolean) => {
        const actions = taskMenuActions({
          isFavorite,
          canFavorite: true,
          onFavorite,
          onUnfavorite,
        });
        await act(async () => {
          root.render(
            surface === 'context'
              ? createElement(TaskContextMenu, {
                  ...actions,
                  children: createElement('div', null, 'Task'),
                })
              : createElement(TaskActionsMenu, {
                  ...actions,
                  trigger: createElement('button', null, 'More'),
                })
          );
        });
      };

      await renderMenu(false);
      await act(async () => findButton(host, 'tasks.context.favoriteTask')?.click());
      expect(onFavorite).toHaveBeenCalledOnce();

      await renderMenu(true);
      await act(async () => findButton(host, 'tasks.context.unfavoriteTask')?.click());
      expect(onUnfavorite).toHaveBeenCalledOnce();
    }
  );

  it.each(['context', 'dropdown'] as const)(
    'shows project-scoped quick actions in the shared task %s menu',
    async (surface) => {
      const { TaskActionsMenu, TaskContextMenu } = await import(
        '@renderer/features/tasks/components/task-context-menu'
      );
      const quickAction: QuickAction = {
        id: 'review-project',
        label: 'Review project',
        command: 'Review the current project changes.',
        kind: 'skill',
      };
      const onRunQuickAction = vi.fn();
      const onCaptureAutomation = vi.fn();
      const onManageQuickActions = vi.fn();
      const actions = taskMenuActions({
        quickActions: [quickAction],
        onRunQuickAction,
        onCaptureAutomation,
        onManageQuickActions,
      });

      await act(async () => {
        root.render(
          surface === 'context'
            ? createElement(TaskContextMenu, {
                ...actions,
                children: createElement('div', null, 'Task'),
              })
            : createElement(TaskActionsMenu, {
                ...actions,
                trigger: createElement('button', null, 'More'),
              })
        );
      });

      expect(host.textContent).toContain('sidebar.captureAutomation.menuLabel');
      await act(async () => findButton(host, quickAction.label)?.click());
      expect(onRunQuickAction).toHaveBeenCalledWith(quickAction);
      await act(async () => findButton(host, 'sidebar.captureAutomation.createLabel')?.click());
      expect(onCaptureAutomation).toHaveBeenCalledOnce();
      await act(async () => findButton(host, 'projects.quickActions.manage')?.click());
      expect(onManageQuickActions).toHaveBeenCalledOnce();
    }
  );
});

function findButton(host: HTMLElement, label: string): HTMLButtonElement | undefined {
  return Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find((button) =>
    button.textContent?.includes(label)
  );
}
