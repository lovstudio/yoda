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
  useTranslation: () => ({
    t: (key: string) => key,
  }),
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

vi.mock('@renderer/lib/hooks/use-toast', () => ({
  toast: vi.fn(),
}));

vi.mock('@renderer/lib/ipc', () => ({
  rpc: {},
}));

vi.mock('@renderer/lib/ui/context-menu', async () => {
  const { createElement: create } = await import('react');
  return {
    ContextMenu: createContainer('context-menu', create),
    ContextMenuContent: createContainer('context-menu-content', create),
    ContextMenuItem: createItem('context-menu-item', create),
    ContextMenuSeparator: () => create('hr'),
    ContextMenuTrigger: createContainer('context-menu-trigger', create),
  };
});

vi.mock('@renderer/lib/ui/dropdown-menu', async () => {
  const { createElement: create } = await import('react');
  return {
    DropdownMenu: createContainer('dropdown-menu', create),
    DropdownMenuContent: createContainer('dropdown-menu-content', create),
    DropdownMenuItem: createItem('dropdown-menu-item', create),
    DropdownMenuSeparator: () => create('hr'),
    DropdownMenuTrigger: ({ render }: { render: ReactElement }) =>
      create('span', { 'data-slot': 'dropdown-menu-trigger' }, render),
  };
});

function createContainer(
  slot: string,
  create: typeof createElement
): ({ children }: { children?: ReactNode }) => ReactElement {
  return ({ children }) => create('div', { 'data-slot': slot }, children);
}

function createItem(
  slot: string,
  create: typeof createElement
): (
  props: ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: string;
  }
) => ReactElement {
  return ({ children, variant: _variant, ...props }) =>
    create('button', { ...props, 'data-slot': slot }, children);
}

describe('task long-term menu action', () => {
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

  it.each([
    ['context', 'context-menu-item'],
    ['dropdown', 'dropdown-menu-item'],
  ] as const)('toggles the marker from the shared %s menu', async (surface, itemSlot) => {
    const { TaskActionsMenu, TaskContextMenu } = await import(
      '@renderer/features/tasks/components/task-context-menu'
    );
    const onMarkLongTerm = vi.fn();
    const onUnmarkLongTerm = vi.fn();
    const renderMenu = async (isLongTerm: boolean) => {
      const actions = requiredActions({ isLongTerm, onMarkLongTerm, onUnmarkLongTerm });
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
    const markItem = findMenuItem(host, itemSlot, 'tasks.context.markLongTerm');
    await act(async () => markItem?.click());
    expect(onMarkLongTerm).toHaveBeenCalledOnce();

    await renderMenu(true);
    const unmarkItem = findMenuItem(host, itemSlot, 'tasks.context.unmarkLongTerm');
    await act(async () => unmarkItem?.click());
    expect(onUnmarkLongTerm).toHaveBeenCalledOnce();
  });
});

function findMenuItem(
  host: HTMLElement,
  itemSlot: string,
  label: string
): HTMLButtonElement | undefined {
  return Array.from(
    host.querySelectorAll<HTMLButtonElement>(`button[data-slot="${itemSlot}"]`)
  ).find((item) => item.textContent?.includes(label));
}

function requiredActions(
  values: Pick<TaskMenuActions, 'isLongTerm' | 'onMarkLongTerm' | 'onUnmarkLongTerm'>
): TaskMenuActions {
  return {
    ...values,
    isPinned: false,
    canPin: true,
    isFavorite: false,
    canFavorite: true,
    canMarkLongTerm: true,
    isArchived: false,
    needsReview: false,
    canMarkReview: true,
    onPin: vi.fn(),
    onUnpin: vi.fn(),
    onFavorite: vi.fn(),
    onUnfavorite: vi.fn(),
    onMarkNeedsReview: vi.fn(),
    onUnmarkNeedsReview: vi.fn(),
    onRename: vi.fn(),
    onArchiveQuick: vi.fn(),
    onArchive: vi.fn(),
  };
}
