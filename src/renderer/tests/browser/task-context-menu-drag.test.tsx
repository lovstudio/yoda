import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

vi.mock('@renderer/lib/hooks/use-toast', () => ({
  toast: vi.fn(),
}));

vi.mock('@renderer/lib/ipc', () => ({
  rpc: {},
}));

describe('TaskContextMenu drag isolation', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    document
      .querySelectorAll('[data-slot="context-menu-content"]')
      .forEach((node) => node.remove());
    host.remove();
  });

  it('does not forward a menu-item press to the draggable task row', async () => {
    const { TaskContextMenu } = await import(
      '@renderer/features/tasks/components/task-context-menu'
    );
    const onTaskPointerDown = vi.fn();
    const onTaskMouseDown = vi.fn();

    await act(async () => {
      root.render(
        createElement(
          'div',
          { onPointerDown: onTaskPointerDown, onMouseDown: onTaskMouseDown },
          createElement(TaskContextMenu, {
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
            children: createElement('button', { type: 'button' }, 'Task'),
          })
        )
      );
    });

    const trigger = host.querySelector('button');
    await act(async () => {
      trigger?.dispatchEvent(
        new MouseEvent('contextmenu', {
          bubbles: true,
          button: 2,
          clientX: 20,
          clientY: 20,
        })
      );
    });

    const item = document.querySelector<HTMLElement>('[data-slot="context-menu-item"]');
    expect(item).not.toBeNull();

    await act(async () => {
      item?.dispatchEvent(
        new PointerEvent('pointerdown', {
          bubbles: true,
          button: 0,
          clientX: 24,
          clientY: 24,
        })
      );
      item?.dispatchEvent(
        new MouseEvent('mousedown', {
          bubbles: true,
          button: 0,
          clientX: 24,
          clientY: 24,
        })
      );
    });

    expect(onTaskPointerDown).not.toHaveBeenCalled();
    expect(onTaskMouseDown).not.toHaveBeenCalled();
  });
});
