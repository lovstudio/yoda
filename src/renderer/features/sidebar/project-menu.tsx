import type { TFunction } from 'i18next';
import {
  Archive,
  ArchiveRestore,
  ArchiveX,
  Bot,
  CableIcon,
  Copy,
  Eye,
  EyeOff,
  Folder,
  FolderPen,
  Info,
  PencilLine,
  Pin,
  PinOff,
  Plus,
  RotateCcw,
  Trash2,
} from 'lucide-react';
import React, { useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ProjectQuickActionsContextSubmenu,
  ProjectQuickActionsDropdownSubmenu,
  type ProjectQuickActionsMenuActions,
} from '@renderer/features/projects/project-quick-actions-menu';
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
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from '@renderer/lib/ui/context-menu';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@renderer/lib/ui/dropdown-menu';

export interface ProjectMenuActions extends ProjectQuickActionsMenuActions {
  isPinned: boolean;
  canPin: boolean;
  isSsh: boolean;
  canReconnect: boolean;
  projectPath?: string;
  sshConnectionId?: string | null;
  onCopyYodaLink?: () => void;
  onPin: () => void;
  onUnpin: () => void;
  /**
   * Privacy allowlist toggle. Present regardless of privacy mode — the
   * allowlist is configured while names are still legible.
   */
  redaction?: { exempt: boolean; onToggle: () => void };
  onOpenDetails?: () => void;
  onCreateTask?: () => void;
  onCreateTaskAndRun?: () => void;
  onOpenArchivedTasks?: () => void;
  onReconnect?: () => void;
  onChangeSshConnection?: () => void;
  onMenuOpen?: () => void;
  onRename?: () => void;
  onMovePath?: () => void;
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
  kind?: 'action' | 'open-in' | 'quick-actions';
}

function useMenuItems(actions: ProjectMenuActions): MenuItemDescriptor[] {
  const { t } = useTranslation();
  const items: MenuItemDescriptor[] = [];

  // group 0 — task creation
  if (actions.onCreateTask) {
    items.push({
      key: 'create-task',
      group: 0,
      icon: Plus,
      label: t('sidebar.newTask'),
      onSelect: actions.onCreateTask,
    });
  }
  if (actions.onCreateTaskAndRun) {
    items.push({
      key: 'create-task-and-run',
      group: 0,
      icon: Bot,
      label: t('sidebar.newTaskAndRun'),
      onSelect: actions.onCreateTaskAndRun,
    });
  }

  // group 1 — primary navigation
  if (actions.onOpenDetails) {
    items.push({
      key: 'open-details',
      group: 1,
      icon: Info,
      label: t('sidebar.openProjectDetails'),
      onSelect: actions.onOpenDetails,
    });
  }
  if (actions.projectPath) {
    const path = actions.projectPath;
    items.push({
      key: 'open-in',
      group: 1,
      kind: 'open-in',
    });
    // group 2 — path utilities
    items.push({
      key: 'copy-project-path',
      group: 2,
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
      group: 2,
      icon: Copy,
      label: t('sidebar.copyProjectYodaLink'),
      onSelect: actions.onCopyYodaLink,
    });
  }

  if (actions.canPin) {
    items.push(
      actions.isPinned
        ? {
            key: 'unpin',
            group: 3,
            icon: PinOff,
            label: t('sidebar.unpinProject'),
            onSelect: actions.onUnpin,
          }
        : {
            key: 'pin',
            group: 3,
            icon: Pin,
            label: t('sidebar.pinProject'),
            onSelect: actions.onPin,
          }
    );
  }
  if (actions.onRename) {
    items.push({
      key: 'rename',
      group: 3,
      icon: PencilLine,
      label: t('sidebar.renameProject.menuLabel'),
      onSelect: actions.onRename,
    });
  }
  if (actions.onMovePath) {
    items.push({
      key: 'move-path',
      group: 3,
      icon: FolderPen,
      label: t('sidebar.moveProjectPath.menuLabel'),
      onSelect: actions.onMovePath,
    });
  }
  // group 4 — ssh
  if (actions.isSsh) {
    if (actions.onReconnect) {
      items.push({
        key: 'reconnect',
        group: 4,
        icon: RotateCcw,
        label: t('sidebar.reconnect'),
        onSelect: actions.onReconnect,
        disabled: !actions.canReconnect,
      });
    }
    if (actions.onChangeSshConnection) {
      items.push({
        key: 'change-ssh',
        group: 4,
        icon: CableIcon,
        label: t('sidebar.changeSshConnection'),
        onSelect: actions.onChangeSshConnection,
      });
    }
  }

  // group 5 — project lifecycle
  items.push({
    key: 'archive-project',
    group: 5,
    icon: Archive,
    label: t('sidebar.archiveProject'),
    onSelect: actions.onArchiveProject,
    disabled: !actions.canArchiveProject,
  });
  items.push({
    key: 'archive-project-tasks',
    group: 5,
    icon: ArchiveX,
    label: t('sidebar.archiveProjectTasks'),
    onSelect: actions.onArchiveProjectTasks,
    disabled: !actions.canArchiveProjectTasks,
  });
  if (actions.onOpenArchivedTasks) {
    items.push({
      key: 'open-archived-tasks',
      group: 5,
      icon: ArchiveRestore,
      label: t('sidebar.openArchivedTasks'),
      onSelect: actions.onOpenArchivedTasks,
    });
  }
  items.push({
    key: 'remove-project',
    group: 5,
    icon: Trash2,
    label: t('projects.removeProject'),
    onSelect: actions.onRemoveProject,
    disabled: !actions.canRemoveProject,
    variant: 'destructive',
  });

  // group 6 — privacy allowlist, on its own: it is a display setting, neither
  // part of the project's lifecycle above nor of the operations below.
  if (actions.redaction) {
    const { exempt, onToggle } = actions.redaction;
    items.push({
      key: 'redaction-exempt',
      group: 6,
      icon: exempt ? EyeOff : Eye,
      label: exempt
        ? t('sidebar.privacyExempt.removeMenuLabel')
        : t('sidebar.privacyExempt.addMenuLabel'),
      onSelect: onToggle,
    });
  }

  // group 7 — repeatable project operations
  if (actions.onCaptureAutomation) {
    items.push({
      key: 'quick-actions',
      group: 7,
      kind: 'quick-actions',
      label: t('sidebar.captureAutomation.menuLabel'),
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

/**
 * Project-menu prefetch can synchronously publish several MobX loading states
 * before its RPCs yield. Let the menu commit and paint first so a cold project
 * never makes the context-menu gesture wait for repository/settings/terminal
 * preparation.
 */
function useProjectMenuPrefetchAfterPaint(onMenuOpen?: () => void) {
  const firstFrameRef = useRef<number | null>(null);
  const secondFrameRef = useRef<number | null>(null);

  const cancel = useCallback(() => {
    if (firstFrameRef.current !== null) {
      window.cancelAnimationFrame(firstFrameRef.current);
      firstFrameRef.current = null;
    }
    if (secondFrameRef.current !== null) {
      window.cancelAnimationFrame(secondFrameRef.current);
      secondFrameRef.current = null;
    }
  }, []);

  useEffect(() => cancel, [cancel]);

  return useCallback(
    (open: boolean) => {
      cancel();
      if (!open || !onMenuOpen) return;

      firstFrameRef.current = window.requestAnimationFrame(() => {
        firstFrameRef.current = null;
        secondFrameRef.current = window.requestAnimationFrame(() => {
          secondFrameRef.current = null;
          onMenuOpen();
        });
      });
    },
    [cancel, onMenuOpen]
  );
}

export function ProjectContextMenu({ children, ...actions }: ProjectContextMenuProps) {
  const items = useMenuItems(actions);
  const scheduleMenuPrefetch = useProjectMenuPrefetchAfterPaint(() => {
    actions.onQuickActionsMenuOpen?.();
    actions.onMenuOpen?.();
  });
  return (
    <ContextMenu onOpenChange={scheduleMenuPrefetch}>
      <ContextMenuTrigger className="block w-full min-w-0 overflow-hidden">
        {children}
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ProjectContextMenuItems actions={actions} items={items} />
      </ContextMenuContent>
    </ContextMenu>
  );
}

/**
 * The project menu's items, without a surrounding container. Shared by the
 * project's own context menu and by the nested 「项目」 submenu so both surfaces
 * offer exactly the same operations.
 */
function ProjectContextMenuItems({
  actions,
  items,
}: {
  actions: ProjectMenuActions;
  items: MenuItemDescriptor[];
}) {
  return (
    <>
      {items.map((item, index) => {
        const prev = items[index - 1];
        const showSeparator = prev && prev.group !== item.group;
        const workspaceAssign = item.key === 'remove-project' ? actions.onAssignWorkspace : null;
        if (item.kind === 'quick-actions') {
          return (
            <React.Fragment key={item.key}>
              {showSeparator && <ContextMenuSeparator />}
              <ProjectQuickActionsContextSubmenu actions={actions} />
            </React.Fragment>
          );
        }
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
    </>
  );
}

/**
 * The project menu nested one level down, for surfaces that belong to a project
 * without being one (a task row). Shares the item list verbatim: a surface that
 * reaches the project offers exactly the project's own operations, quick
 * actions included.
 */
export function ProjectContextSubmenu({ actions }: { actions: ProjectMenuActions }) {
  const { t } = useTranslation();
  const items = useMenuItems(actions);
  const scheduleMenuPrefetch = useProjectMenuPrefetchAfterPaint(() => {
    actions.onQuickActionsMenuOpen?.();
    actions.onMenuOpen?.();
  });
  return (
    <ContextMenuSub onOpenChange={scheduleMenuPrefetch}>
      <ContextMenuSubTrigger>
        <Folder className="size-4" />
        {t('tasks.context.projectMenu')}
      </ContextMenuSubTrigger>
      <ContextMenuSubContent className="min-w-48">
        <ProjectContextMenuItems actions={actions} items={items} />
      </ContextMenuSubContent>
    </ContextMenuSub>
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
  const scheduleMenuPrefetch = useProjectMenuPrefetchAfterPaint(() => {
    actions.onQuickActionsMenuOpen?.();
    actions.onMenuOpen?.();
  });
  return (
    <DropdownMenu
      open={open}
      onOpenChange={(nextOpen) => {
        scheduleMenuPrefetch(nextOpen);
        onOpenChange?.(nextOpen);
      }}
    >
      <DropdownMenuTrigger render={trigger} />
      <DropdownMenuContent align={align} className="min-w-44">
        <ProjectDropdownMenuItems actions={actions} items={items} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Dropdown twin of {@link ProjectContextMenuItems}. */
function ProjectDropdownMenuItems({
  actions,
  items,
}: {
  actions: ProjectMenuActions;
  items: MenuItemDescriptor[];
}) {
  return (
    <>
      {items.map((item, index) => {
        const prev = items[index - 1];
        const showSeparator = prev && prev.group !== item.group;
        const workspaceAssign = item.key === 'remove-project' ? actions.onAssignWorkspace : null;
        if (item.kind === 'quick-actions') {
          return (
            <React.Fragment key={item.key}>
              {showSeparator && <DropdownMenuSeparator />}
              <ProjectQuickActionsDropdownSubmenu actions={actions} />
            </React.Fragment>
          );
        }
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
    </>
  );
}

/** Dropdown twin of {@link ProjectContextSubmenu}. */
export function ProjectDropdownSubmenu({ actions }: { actions: ProjectMenuActions }) {
  const { t } = useTranslation();
  const items = useMenuItems(actions);
  const scheduleMenuPrefetch = useProjectMenuPrefetchAfterPaint(() => {
    actions.onQuickActionsMenuOpen?.();
    actions.onMenuOpen?.();
  });
  return (
    <DropdownMenuSub onOpenChange={scheduleMenuPrefetch}>
      <DropdownMenuSubTrigger>
        <Folder className="size-4" />
        {t('tasks.context.projectMenu')}
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="min-w-48">
        <ProjectDropdownMenuItems actions={actions} items={items} />
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}
