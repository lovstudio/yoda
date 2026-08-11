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

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const translations: Record<string, string> = {
  'sidebar.configureSystemPrompt': 'Configure System Prompt',
  'sidebar.captureAutomation.menuLabel': 'Quick actions',
  'sidebar.captureAutomation.createLabel': 'New quick action…',
  'sidebar.captureAutomation.noCommands': 'No previously run quick actions.',
  'sidebar.captureAutomation.commandKind': 'Command',
  'sidebar.captureAutomation.skillKind': 'Skill',
  'sidebar.captureAutomation.running': 'Running',
  'projects.quickActions.manage': 'Manage quick actions',
};

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => translations[key] ?? key,
  }),
}));

vi.mock('@renderer/features/workspaces/workspace-assign-submenu', () => ({
  WorkspaceAssignContextSubmenu: () => null,
  WorkspaceAssignDropdownSubmenu: () => null,
}));

vi.mock('@renderer/lib/components/titlebar/open-in-menu', () => ({
  OpenInContextSubmenu: () => null,
  OpenInDropdownSubmenu: () => null,
}));

vi.mock('@renderer/lib/hooks/use-toast', () => ({
  toast: vi.fn(),
}));

vi.mock('@renderer/lib/ipc', () => ({
  rpc: {},
}));

vi.mock('@renderer/lib/ui/context-menu', async () => {
  const { createElement: create } = await import('react');
  const container =
    (slot: string) =>
    ({
      children,
      onOpenChange,
    }: {
      children?: ReactNode;
      onOpenChange?: (open: boolean) => void;
    }) =>
      create(
        'div',
        {
          'data-slot': slot,
          onContextMenu:
            slot === 'context-menu'
              ? (event: React.MouseEvent) => {
                  event.preventDefault();
                  onOpenChange?.(true);
                }
              : undefined,
        },
        children
      );
  const item =
    (slot: string) =>
    ({
      children,
      variant: _variant,
      inset: _inset,
      ...props
    }: ButtonHTMLAttributes<HTMLButtonElement> & {
      variant?: string;
      inset?: boolean;
    }) =>
      create('button', { ...props, 'data-slot': slot }, children);

  return {
    ContextMenu: container('context-menu'),
    ContextMenuContent: container('context-menu-content'),
    ContextMenuGroup: container('context-menu-group'),
    ContextMenuItem: item('context-menu-item'),
    ContextMenuLabel: container('context-menu-label'),
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
  const item =
    (slot: string) =>
    ({
      children,
      variant: _variant,
      inset: _inset,
      ...props
    }: ButtonHTMLAttributes<HTMLButtonElement> & {
      variant?: string;
      inset?: boolean;
    }) =>
      create('button', { ...props, 'data-slot': slot }, children);

  return {
    DropdownMenu: container('dropdown-menu'),
    DropdownMenuContent: container('dropdown-menu-content'),
    DropdownMenuGroup: container('dropdown-menu-group'),
    DropdownMenuItem: item('dropdown-menu-item'),
    DropdownMenuLabel: container('dropdown-menu-label'),
    DropdownMenuSeparator: () => create('hr'),
    DropdownMenuSub: container('dropdown-menu-sub'),
    DropdownMenuSubContent: container('dropdown-menu-sub-content'),
    DropdownMenuSubTrigger: container('dropdown-menu-sub-trigger'),
    DropdownMenuTrigger: ({ render }: { render: ReactElement }) =>
      create('span', { 'data-slot': 'dropdown-menu-trigger' }, render),
  };
});

const savedAction: QuickAction = {
  id: 'saved-action',
  label: 'Start and verify',
  command: 'Start this project and verify the local URL.',
  kind: 'skill',
};

function requiredActions() {
  return {
    isPinned: false,
    canPin: false,
    isSsh: false,
    canReconnect: false,
    canArchiveProject: true,
    canArchiveProjectTasks: false,
    canRemoveProject: true,
    onPin: vi.fn(),
    onUnpin: vi.fn(),
    onArchiveProject: vi.fn(),
    onArchiveProjectTasks: vi.fn(),
    onRemoveProject: vi.fn(),
  };
}

describe('ProjectMenu quick actions submenu', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  it.each([
    ['context', 'context-menu-item'],
    ['dropdown', 'dropdown-menu-item'],
  ] as const)('shows both task creation intents in the %s menu', async (surface, itemSlot) => {
    const { ProjectActionsMenu, ProjectContextMenu } = await import(
      '@renderer/features/sidebar/project-menu'
    );
    const onCreateTask = vi.fn();
    const onCreateTaskAndRun = vi.fn();
    const actions = {
      ...requiredActions(),
      onCreateTask,
      onCreateTaskAndRun,
      onOpenDetails: vi.fn(),
    };

    await act(async () => {
      root.render(
        surface === 'context'
          ? createElement(ProjectContextMenu, {
              ...actions,
              children: createElement('div', null, 'Example project'),
            })
          : createElement(ProjectActionsMenu, {
              ...actions,
              trigger: createElement('button', null, 'More'),
            })
      );
    });

    const items = Array.from(
      host.querySelectorAll<HTMLButtonElement>(`button[data-slot="${itemSlot}"]`)
    );
    const createTaskItem = items.find((item) => item.textContent === 'sidebar.newTask');
    const createAndRunItem = items.find((item) => item.textContent === 'sidebar.newTaskAndRun');
    const openDetailsItem = items.find((item) => item.textContent === 'sidebar.openProjectDetails');

    expect(createTaskItem?.nextElementSibling).toBe(createAndRunItem);
    expect(createAndRunItem?.nextElementSibling?.tagName).toBe('HR');
    expect(createAndRunItem?.nextElementSibling?.nextElementSibling).toBe(openDetailsItem);

    await act(async () => createTaskItem?.click());
    expect(onCreateTask).toHaveBeenCalledTimes(1);
    await act(async () => createAndRunItem?.click());
    expect(onCreateTaskAndRun).toHaveBeenCalledTimes(1);
  });

  it('paints the context menu before starting cold project prefetch', async () => {
    const frameCallbacks: FrameRequestCallback[] = [];
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frameCallbacks.push(callback);
      return frameCallbacks.length;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});

    const { ProjectContextMenu } = await import('@renderer/features/sidebar/project-menu');
    const onMenuOpen = vi.fn();

    await act(async () => {
      root.render(
        createElement(ProjectContextMenu, {
          ...requiredActions(),
          onMenuOpen,
          children: createElement('div', null, 'Cold project'),
        })
      );
    });

    await act(async () => {
      host
        .querySelector('[data-slot="context-menu"]')
        ?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    });

    expect(onMenuOpen).not.toHaveBeenCalled();
    expect(frameCallbacks).toHaveLength(1);

    await act(async () => frameCallbacks.shift()?.(16));
    expect(onMenuOpen).not.toHaveBeenCalled();
    expect(frameCallbacks).toHaveLength(1);

    await act(async () => frameCallbacks.shift()?.(32));
    expect(onMenuOpen).toHaveBeenCalledOnce();
  });

  it.each([
    ['context', 'context-menu-item'],
    ['dropdown', 'dropdown-menu-item'],
  ] as const)(
    'opens project System Prompt configuration from the %s menu',
    async (surface, itemSlot) => {
      const { ProjectActionsMenu, ProjectContextMenu } = await import(
        '@renderer/features/sidebar/project-menu'
      );
      const onConfigureSystemPrompt = vi.fn();
      const actions = {
        ...requiredActions(),
        onConfigureSystemPrompt,
      };

      await act(async () => {
        root.render(
          surface === 'context'
            ? createElement(ProjectContextMenu, {
                ...actions,
                children: createElement('div', null, 'Example project'),
              })
            : createElement(ProjectActionsMenu, {
                ...actions,
                trigger: createElement('button', null, 'More'),
              })
        );
      });

      const item = Array.from(
        host.querySelectorAll<HTMLButtonElement>(`button[data-slot="${itemSlot}"]`)
      ).find((candidate) => candidate.textContent === 'Configure System Prompt');

      expect(item).toBeDefined();
      await act(async () => item?.click());
      expect(onConfigureSystemPrompt).toHaveBeenCalledTimes(1);
    }
  );

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  it.each([
    ['context', 'context-menu-item'],
    ['dropdown', 'dropdown-menu-item'],
  ] as const)(
    'shows only previously run actions in the %s menu and keeps creation discoverable',
    async (surface, itemSlot) => {
      const { ProjectActionsMenu, ProjectContextMenu } = await import(
        '@renderer/features/sidebar/project-menu'
      );
      const onRunQuickAction = vi.fn();
      const onCaptureAutomation = vi.fn();
      const onManageQuickActions = vi.fn();
      const actions = {
        ...requiredActions(),
        quickActions: [savedAction],
        onRunQuickAction,
        onCaptureAutomation,
        onManageQuickActions,
      };

      await act(async () => {
        root.render(
          surface === 'context'
            ? createElement(ProjectContextMenu, {
                ...actions,
                children: createElement('div', null, 'Example project'),
              })
            : createElement(ProjectActionsMenu, {
                ...actions,
                trigger: createElement('button', null, 'More'),
              })
        );
      });

      expect(host.querySelector('[data-slot$="menu-sub-trigger"]')?.textContent).toContain(
        'Quick actions'
      );
      const items = Array.from(
        host.querySelectorAll<HTMLButtonElement>(`button[data-slot="${itemSlot}"]`)
      );
      const savedActionItem = items.find((item) => item.textContent?.includes(savedAction.label));
      const createActionItem = items.find((item) => item.textContent?.includes('New quick action'));
      const manageActionsItem = items.find((item) =>
        item.textContent?.includes('Manage quick actions')
      );

      expect(host.textContent).not.toContain('pnpm run dev');
      await act(async () => savedActionItem?.click());
      expect(onRunQuickAction).toHaveBeenCalledWith(savedAction);

      await act(async () => createActionItem?.click());
      expect(onCaptureAutomation).toHaveBeenCalledTimes(1);
      await act(async () => manageActionsItem?.click());
      expect(onManageQuickActions).toHaveBeenCalledTimes(1);
    }
  );

  it.each([
    ['context', 'context-menu-item'],
    ['dropdown', 'dropdown-menu-item'],
  ] as const)(
    'shows a running action and navigates to its existing run in the %s menu',
    async (surface, itemSlot) => {
      const { ProjectActionsMenu, ProjectContextMenu } = await import(
        '@renderer/features/sidebar/project-menu'
      );
      const onRunQuickAction = vi.fn();
      const onNavigateQuickAction = vi.fn();
      const actions = {
        ...requiredActions(),
        quickActions: [savedAction],
        canRunQuickAction: () => false,
        isQuickActionRunning: () => true,
        onRunQuickAction,
        onNavigateQuickAction,
        onCaptureAutomation: vi.fn(),
      };

      await act(async () => {
        root.render(
          surface === 'context'
            ? createElement(ProjectContextMenu, {
                ...actions,
                children: createElement('div', null, 'Example project'),
              })
            : createElement(ProjectActionsMenu, {
                ...actions,
                trigger: createElement('button', null, 'More'),
              })
        );
      });

      const item = Array.from(
        host.querySelectorAll<HTMLButtonElement>(`button[data-slot="${itemSlot}"]`)
      ).find((candidate) => candidate.textContent?.includes(savedAction.label));

      expect(item?.textContent).toContain('Running');
      expect(item?.disabled).toBe(false);
      await act(async () => item?.click());
      expect(onNavigateQuickAction).toHaveBeenCalledWith(savedAction);
      expect(onRunQuickAction).not.toHaveBeenCalled();
    }
  );
});
