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
import type { ProjectLaunchCommand } from '@shared/quick-actions';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const translations: Record<string, string> = {
  'sidebar.captureAutomation.menuLabel': 'Launch commands',
  'sidebar.captureAutomation.createLabel': 'Generate command from a requirement…',
  'sidebar.captureAutomation.detectedCommands': 'Detected from project',
  'sidebar.captureAutomation.savedCommands': 'Saved commands',
  'sidebar.captureAutomation.loadingCommands': 'Reading project commands…',
  'sidebar.captureAutomation.loadCommandsFailed': 'Project commands could not be read.',
  'sidebar.captureAutomation.noCommands': 'No launch commands detected.',
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
  kind: 'agent',
};

const detectedCommand: ProjectLaunchCommand = {
  id: 'package.json:dev',
  label: 'dev',
  command: 'pnpm run dev',
  source: 'package.json',
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

describe('ProjectMenu launch commands submenu', () => {
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
  ] as const)(
    'shows detected and saved commands in the %s menu and keeps generation discoverable',
    async (surface, itemSlot) => {
      const { ProjectActionsMenu, ProjectContextMenu } = await import(
        '@renderer/features/sidebar/project-menu'
      );
      const onRunLaunchCommand = vi.fn();
      const onRunQuickAction = vi.fn();
      const onCaptureAutomation = vi.fn();
      const onManageQuickActions = vi.fn();
      const actions = {
        ...requiredActions(),
        quickActions: [savedAction],
        launchCommands: [detectedCommand],
        onRunLaunchCommand,
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
        'Launch commands'
      );
      const labels = Array.from(host.querySelectorAll<HTMLElement>('[data-slot$="menu-label"]'));
      expect(labels).toHaveLength(2);
      expect(
        labels.every((label) => label.parentElement?.dataset.slot === `${surface}-menu-group`)
      ).toBe(true);
      const items = Array.from(
        host.querySelectorAll<HTMLButtonElement>(`button[data-slot="${itemSlot}"]`)
      );
      const detectedCommandItem = items.find((item) =>
        item.textContent?.includes(detectedCommand.command)
      );
      const savedActionItem = items.find((item) => item.textContent?.includes(savedAction.label));
      const createActionItem = items.find((item) =>
        item.textContent?.includes('Generate command from a requirement')
      );
      const manageActionsItem = items.find((item) =>
        item.textContent?.includes('Manage quick actions')
      );

      await act(async () => detectedCommandItem?.click());
      expect(onRunLaunchCommand).toHaveBeenCalledWith(detectedCommand);
      expect(onRunQuickAction).not.toHaveBeenCalled();
      await act(async () => savedActionItem?.click());
      expect(onRunQuickAction).toHaveBeenCalledWith(savedAction);

      await act(async () => createActionItem?.click());
      expect(onCaptureAutomation).toHaveBeenCalledTimes(1);
      await act(async () => manageActionsItem?.click());
      expect(onManageQuickActions).toHaveBeenCalledTimes(1);
    }
  );
});
