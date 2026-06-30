import type { TFunction } from 'i18next';
import {
  Archive,
  ArchiveX,
  CableIcon,
  Copy,
  Info,
  PencilLine,
  Pin,
  PinOff,
  RotateCcw,
  Settings2,
  Trash2,
  WandSparkles,
} from 'lucide-react';
import React from 'react';
import { useTranslation } from 'react-i18next';
import {
  WorkspaceAssignContextSubmenu,
  WorkspaceAssignDropdownSubmenu,
} from '@renderer/features/workspaces/workspace-assign-submenu';
import {
  OpenInContextSubmenu,
  OpenInDropdownSubmenu,
} from '@renderer/lib/components/titlebar/open-in-menu';
import { toast } from '@renderer/lib/hooks/use-toast';
import { rpc } from '@renderer/lib/ipc';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@renderer/lib/ui/context-menu';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@renderer/lib/ui/dropdown-menu';

interface ProjectMenuActions {
  isPinned: boolean;
  canPin: boolean;
  isSsh: boolean;
  canReconnect: boolean;
  projectPath?: string;
  sshConnectionId?: string | null;
  onCopyYodaLink?: () => void;
  onPin: () => void;
  onUnpin: () => void;
  onOpenDetails?: () => void;
  onReconnect?: () => void;
  onChangeSshConnection?: () => void;
  onConfigureScripts?: () => void;
  onCaptureAutomation?: () => void;
  onRename?: () => void;
  canArchiveProject: boolean;
  canArchiveProjectTasks: boolean;
  canRemoveProject: boolean;
  onArchiveProject: () => void;
  onArchiveProjectTasks: () => void;
  onRemoveProject: () => void;
  /** Current sidebar workspace assignment (null = default/unassigned). */
  currentWorkspaceId?: string | null;
  /** Assign this project to a workspace, or null to move it to the default. */
  onAssignWorkspace?: (workspaceId: string | null) => void;
}

interface MenuItemDescriptor {
  key: string;
  group: number;
  icon?: React.ComponentType<{ className?: string }>;
  label?: string;
  onSelect?: () => void;
  disabled?: boolean;
  variant?: 'default' | 'destructive';
  kind?: 'action' | 'open-in';
}

function useMenuItems(actions: ProjectMenuActions): MenuItemDescriptor[] {
  const { t } = useTranslation();
  const items: MenuItemDescriptor[] = [];

  // group 0 — primary navigation
  if (actions.onOpenDetails) {
    items.push({
      key: 'open-details',
      group: 0,
      icon: Info,
      label: t('sidebar.openProjectDetails'),
      onSelect: actions.onOpenDetails,
    });
  }

  // Keep "Open in..." in the first group with primary project actions.
  if (actions.projectPath) {
    const path = actions.projectPath;
    items.push({
      key: 'open-in',
      group: 0,
      kind: 'open-in',
    });
    // group 1 — path utilities
    items.push({
      key: 'copy-project-path',
      group: 1,
      icon: Copy,
      label: t('sidebar.copyProjectPath'),
      onSelect: () => {
        void copyProjectPath(path, t);
      },
    });
  }
  if (actions.onCopyYodaLink) {
    items.push({
      key: 'copy-yoda-link',
      group: 1,
      icon: Copy,
      label: t('sidebar.copyProjectYodaLink'),
      onSelect: actions.onCopyYodaLink,
    });
  }

  // group 2 — configuration
  if (actions.canPin) {
    items.push(
      actions.isPinned
        ? {
            key: 'unpin',
            group: 2,
            icon: PinOff,
            label: t('sidebar.unpinProject'),
            onSelect: actions.onUnpin,
          }
        : {
            key: 'pin',
            group: 2,
            icon: Pin,
            label: t('sidebar.pinProject'),
            onSelect: actions.onPin,
          }
    );
  }
  if (actions.onRename) {
    items.push({
      key: 'rename',
      group: 2,
      icon: PencilLine,
      label: t('sidebar.renameProject.menuLabel'),
      onSelect: actions.onRename,
    });
  }
  // group 3 — ssh
  if (actions.isSsh) {
    if (actions.onReconnect) {
      items.push({
        key: 'reconnect',
        group: 3,
        icon: RotateCcw,
        label: t('sidebar.reconnect'),
        onSelect: actions.onReconnect,
        disabled: !actions.canReconnect,
      });
    }
    if (actions.onChangeSshConnection) {
      items.push({
        key: 'change-ssh',
        group: 3,
        icon: CableIcon,
        label: t('sidebar.changeSshConnection'),
        onSelect: actions.onChangeSshConnection,
      });
    }
  }

  // group 4 — project lifecycle
  items.push({
    key: 'archive-project',
    group: 4,
    icon: Archive,
    label: t('sidebar.archiveProject'),
    onSelect: actions.onArchiveProject,
    disabled: !actions.canArchiveProject,
  });
  items.push({
    key: 'archive-project-tasks',
    group: 4,
    icon: ArchiveX,
    label: t('sidebar.archiveProjectTasks'),
    onSelect: actions.onArchiveProjectTasks,
    disabled: !actions.canArchiveProjectTasks,
  });
  items.push({
    key: 'remove-project',
    group: 4,
    icon: Trash2,
    label: t('projects.removeProject'),
    onSelect: actions.onRemoveProject,
    disabled: !actions.canRemoveProject,
    variant: 'destructive',
  });

  // group 5 — repeatable project operations
  if (actions.onConfigureScripts) {
    items.push({
      key: 'configure-scripts',
      group: 5,
      icon: Settings2,
      label: t('sidebar.runScripts.configure'),
      onSelect: actions.onConfigureScripts,
    });
  }
  if (actions.onCaptureAutomation) {
    items.push({
      key: 'capture-automation',
      group: 5,
      icon: WandSparkles,
      label: t('sidebar.captureAutomation.menuLabel'),
      onSelect: actions.onCaptureAutomation,
    });
  }

  return items;
}

async function copyProjectPath(path: string, t: TFunction) {
  try {
    const res = await rpc.app.clipboardWriteText(path);
    if (!res?.success) throw new Error(res?.error ?? t('common.unknownError'));
    toast({ title: t('sidebar.projectPathCopied') });
  } catch {
    toast({
      title: t('common.copyFailed'),
      description: t('sidebar.copyProjectPathFailed'),
      variant: 'destructive',
    });
  }
}

interface ProjectContextMenuProps extends ProjectMenuActions {
  children: React.ReactNode;
}

export function ProjectContextMenu({ children, ...actions }: ProjectContextMenuProps) {
  const items = useMenuItems(actions);
  return (
    <ContextMenu>
      <ContextMenuTrigger className="block w-full min-w-0 overflow-hidden">
        {children}
      </ContextMenuTrigger>
      <ContextMenuContent>
        {items.map((item, index) => {
          const prev = items[index - 1];
          const showSeparator = prev && prev.group !== item.group;
          const workspaceAssign = item.key === 'remove-project' ? actions.onAssignWorkspace : null;
          if (item.kind === 'open-in' && actions.projectPath) {
            return (
              <React.Fragment key={item.key}>
                {showSeparator && <ContextMenuSeparator />}
                <OpenInContextSubmenu
                  path={actions.projectPath}
                  isRemote={actions.isSsh}
                  sshConnectionId={actions.sshConnectionId ?? null}
                />
              </React.Fragment>
            );
          }
          const Icon = item.icon;
          if (!Icon || !item.label || !item.onSelect) return null;
          return (
            <React.Fragment key={item.key}>
              {showSeparator && <ContextMenuSeparator />}
              {workspaceAssign && (
                <WorkspaceAssignContextSubmenu
                  currentWorkspaceId={actions.currentWorkspaceId ?? null}
                  onAssign={workspaceAssign}
                />
              )}
              <ContextMenuItem
                disabled={item.disabled}
                variant={item.variant}
                onClick={(e) => {
                  e.stopPropagation();
                  item.onSelect?.();
                }}
              >
                <Icon className="size-4" />
                {item.label}
              </ContextMenuItem>
            </React.Fragment>
          );
        })}
      </ContextMenuContent>
    </ContextMenu>
  );
}

interface ProjectActionsMenuProps extends ProjectMenuActions {
  trigger: React.ReactElement;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  align?: 'start' | 'center' | 'end';
}

export function ProjectActionsMenu({
  trigger,
  open,
  onOpenChange,
  align = 'end',
  ...actions
}: ProjectActionsMenuProps) {
  const items = useMenuItems(actions);
  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger render={trigger} />
      <DropdownMenuContent align={align} className="min-w-44">
        {items.map((item, index) => {
          const prev = items[index - 1];
          const showSeparator = prev && prev.group !== item.group;
          const workspaceAssign = item.key === 'remove-project' ? actions.onAssignWorkspace : null;
          if (item.kind === 'open-in' && actions.projectPath) {
            return (
              <React.Fragment key={item.key}>
                {showSeparator && <DropdownMenuSeparator />}
                <OpenInDropdownSubmenu
                  path={actions.projectPath}
                  isRemote={actions.isSsh}
                  sshConnectionId={actions.sshConnectionId ?? null}
                />
              </React.Fragment>
            );
          }
          const Icon = item.icon;
          if (!Icon || !item.label || !item.onSelect) return null;
          return (
            <React.Fragment key={item.key}>
              {showSeparator && <DropdownMenuSeparator />}
              {workspaceAssign && (
                <WorkspaceAssignDropdownSubmenu
                  currentWorkspaceId={actions.currentWorkspaceId ?? null}
                  onAssign={workspaceAssign}
                />
              )}
              <DropdownMenuItem
                disabled={item.disabled}
                variant={item.variant}
                onClick={(e) => {
                  e.stopPropagation();
                  item.onSelect?.();
                }}
              >
                <Icon className="size-4" />
                {item.label}
              </DropdownMenuItem>
            </React.Fragment>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
