import {
  act,
  createElement,
  type ButtonHTMLAttributes,
  type ReactElement,
  type ReactNode,
} from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TaskMenuActions } from '@renderer/features/tasks/components/task-context-menu';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@renderer/features/settings/use-app-settings-key', () => ({
  useAppSettingsKey: () => ({
    value: { dockSessionHistory: true },
    update: vi.fn(),
  }),
}));

vi.mock('@renderer/features/workspaces/workspace-assign-submenu', () => ({
  WorkspaceAssignContextSubmenu: () => null,
  WorkspaceAssignDropdownSubmenu: () => null,
}));

vi.mock('@renderer/features/tasks/components/move-to-project-submenu', () => ({
  MoveToProjectContextSubmenu: () => null,
  MoveToProjectDropdownSubmenu: () => null,
}));

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
    ContextMenuTrigger: container('context-menu-trigger'),
  };
});

vi.mock('@renderer/lib/ui/dropdown-menu', async () => {
  const { createElement: create } = await import('react');
  const container =
    (slot: string) =>
    ({ children }: { children?: ReactNode }) =>
      create('div', { 'data-slot': slot }, children);

  return {
    DropdownMenu: container('dropdown-menu'),
    DropdownMenuContent: container('dropdown-menu-content'),
    DropdownMenuItem: container('dropdown-menu-item'),
    DropdownMenuSeparator: () => create('hr'),
    DropdownMenuTrigger: ({ render }: { render: ReactElement }) => render,
  };
});

function taskMenuActions(overrides: Partial<TaskMenuActions> = {}): TaskMenuActions {
  return {
    isPinned: false,
    canPin: false,
    isArchived: false,
    needsReview: false,
    canMarkReview: false,
    onPin: vi.fn(),
    onUnpin: vi.fn(),
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

  it('keeps archive actions in the penultimate group', async () => {
    const { TaskContextMenuItems } = await import(
      '@renderer/features/tasks/components/task-context-menu'
    );

    await act(async () => {
      root.render(createElement(TaskContextMenuItems, taskMenuActions()));
    });

    expect(menuGroups(host).slice(-2)).toEqual([
      ['tasks.context.archiveDirect', 'tasks.context.archiveWithSkill'],
      ['tasks.context.reopenTask'],
    ]);
  });

  it('keeps restore in the penultimate group for archived tasks', async () => {
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
          })
        )
      );
    });

    expect(menuGroups(host).slice(-2)).toEqual([
      ['projects.tasks.restore'],
      ['tasks.context.reopenTask'],
    ]);
  });
});
