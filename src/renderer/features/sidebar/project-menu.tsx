import type { TFunction } from 'i18next';
import {
  Archive,
  CableIcon,
  Copy,
  FolderInput,
  FolderOpen,
  Info,
  PencilLine,
  Pin,
  PinOff,
  RotateCcw,
  Settings2,
  Trash2,
} from 'lucide-react';
import { observer } from 'mobx-react-lite';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { ALL_WORKSPACES_ID } from '@shared/workspaces';
import { toast } from '@renderer/lib/hooks/use-toast';
import { rpc } from '@renderer/lib/ipc';
import { workspaceStore } from '@renderer/lib/stores/app-state';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from '@renderer/lib/ui/context-menu';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@renderer/lib/ui/dropdown-menu';

interface ProjectMenuActions {
  isPinned: boolean;
  canPin: boolean;
  isSsh: boolean;
  canReconnect: boolean;
  projectPath?: string;
  onCopyYodaLink?: () => void;
  onPin: () => void;
  onUnpin: () => void;
  onOpenDetails?: () => void;
  onReconnect?: () => void;
  onChangeSshConnection?: () => void;
  onConfigureScripts?: () => void;
  onRename?: () => void;
  canArchiveProjectTasks: boolean;
  canRemoveProject: boolean;
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
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onSelect: () => void;
  disabled?: boolean;
  variant?: 'default' | 'destructive';
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

  // group 1 — path utilities
  if (actions.projectPath) {
    const path = actions.projectPath;
    items.push({
      key: 'copy-project-path',
      group: 1,
      icon: Copy,
      label: t('sidebar.copyProjectPath'),
      onSelect: () => {
        void copyProjectPath(path, t);
      },
    });
    if (!actions.isSsh) {
      items.push({
        key: 'open-project-path',
        group: 1,
        icon: FolderOpen,
        label: t('sidebar.openProjectPath'),
        onSelect: () => {
          void openProjectPath(path, t);
        },
      });
    }
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
  if (actions.onConfigureScripts) {
    items.push({
      key: 'configure-scripts',
      group: 2,
      icon: Settings2,
      label: t('sidebar.runScripts.configure'),
      onSelect: actions.onConfigureScripts,
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
    key: 'archive-project-tasks',
    group: 4,
    icon: Archive,
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

async function openProjectPath(path: string, t: TFunction) {
  try {
    const res = await rpc.app.openIn({ app: 'finder', path });
    if (!res?.success) throw new Error(res?.error ?? t('common.unknownError'));
  } catch (error) {
    toast({
      title: t('openIn.failed'),
      description: error instanceof Error ? error.message : String(error),
      variant: 'destructive',
    });
  }
}

/** Radio value used for the "default / unassigned" workspace choice. */
const DEFAULT_WORKSPACE_VALUE = ALL_WORKSPACES_ID;

const WorkspaceContextSubmenu = observer(function WorkspaceContextSubmenu({
  currentWorkspaceId,
  onAssign,
}: {
  currentWorkspaceId: string | null;
  onAssign: (workspaceId: string | null) => void;
}) {
  const { t } = useTranslation();
  if (workspaceStore.workspaces.length === 0) return null;
  return (
    <>
      <ContextMenuSeparator />
      <ContextMenuSub>
        <ContextMenuSubTrigger>
          <FolderInput className="size-4" />
          {t('workspaces.moveToWorkspace')}
        </ContextMenuSubTrigger>
        <ContextMenuSubContent>
          <ContextMenuRadioGroup value={currentWorkspaceId ?? DEFAULT_WORKSPACE_VALUE}>
            <ContextMenuRadioItem value={DEFAULT_WORKSPACE_VALUE} onClick={() => onAssign(null)}>
              {t('workspaces.defaultWorkspace')}
            </ContextMenuRadioItem>
            {workspaceStore.workspaces.map((workspace) => (
              <ContextMenuRadioItem
                key={workspace.id}
                value={workspace.id}
                onClick={() => onAssign(workspace.id)}
              >
                {workspace.name}
              </ContextMenuRadioItem>
            ))}
          </ContextMenuRadioGroup>
        </ContextMenuSubContent>
      </ContextMenuSub>
    </>
  );
});

const WorkspaceDropdownSubmenu = observer(function WorkspaceDropdownSubmenu({
  currentWorkspaceId,
  onAssign,
}: {
  currentWorkspaceId: string | null;
  onAssign: (workspaceId: string | null) => void;
}) {
  const { t } = useTranslation();
  if (workspaceStore.workspaces.length === 0) return null;
  return (
    <>
      <DropdownMenuSeparator />
      <DropdownMenuSub>
        <DropdownMenuSubTrigger>
          <FolderInput className="size-4" />
          {t('workspaces.moveToWorkspace')}
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent>
          <DropdownMenuRadioGroup value={currentWorkspaceId ?? DEFAULT_WORKSPACE_VALUE}>
            <DropdownMenuRadioItem value={DEFAULT_WORKSPACE_VALUE} onClick={() => onAssign(null)}>
              {t('workspaces.defaultWorkspace')}
            </DropdownMenuRadioItem>
            {workspaceStore.workspaces.map((workspace) => (
              <DropdownMenuRadioItem
                key={workspace.id}
                value={workspace.id}
                onClick={() => onAssign(workspace.id)}
              >
                {workspace.name}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuSubContent>
      </DropdownMenuSub>
    </>
  );
});

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
          const Icon = item.icon;
          return (
            <React.Fragment key={item.key}>
              {showSeparator && <ContextMenuSeparator />}
              <ContextMenuItem
                disabled={item.disabled}
                variant={item.variant}
                onClick={(e) => {
                  e.stopPropagation();
                  item.onSelect();
                }}
              >
                <Icon className="size-4" />
                {item.label}
              </ContextMenuItem>
            </React.Fragment>
          );
        })}
        {actions.onAssignWorkspace && (
          <WorkspaceContextSubmenu
            currentWorkspaceId={actions.currentWorkspaceId ?? null}
            onAssign={actions.onAssignWorkspace}
          />
        )}
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
          const Icon = item.icon;
          return (
            <React.Fragment key={item.key}>
              {showSeparator && <DropdownMenuSeparator />}
              <DropdownMenuItem
                disabled={item.disabled}
                variant={item.variant}
                onClick={(e) => {
                  e.stopPropagation();
                  item.onSelect();
                }}
              >
                <Icon className="size-4" />
                {item.label}
              </DropdownMenuItem>
            </React.Fragment>
          );
        })}
        {actions.onAssignWorkspace && (
          <WorkspaceDropdownSubmenu
            currentWorkspaceId={actions.currentWorkspaceId ?? null}
            onAssign={actions.onAssignWorkspace}
          />
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
