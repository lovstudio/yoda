import type { TFunction } from 'i18next';
import {
  Archive,
  ArchiveRestore,
  ArchiveX,
  CableIcon,
  Copy,
  FolderPen,
  Info,
  Loader2,
  PencilLine,
  Pin,
  PinOff,
  Play,
  RotateCcw,
  Settings2,
  Trash2,
  WandSparkles,
} from 'lucide-react';
import React from 'react';
import { useTranslation } from 'react-i18next';
import type { QuickAction } from '@shared/project-settings';
import type { ProjectLaunchCommand } from '@shared/quick-actions';
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
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from '@renderer/lib/ui/context-menu';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
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
  sshConnectionId?: string | null;
  onCopyYodaLink?: () => void;
  onPin: () => void;
  onUnpin: () => void;
  onOpenDetails?: () => void;
  onOpenArchivedTasks?: () => void;
  onReconnect?: () => void;
  onChangeSshConnection?: () => void;
  onConfigureScripts?: () => void;
  onCaptureAutomation?: () => void;
  onManageQuickActions?: () => void;
  quickActions?: QuickAction[];
  launchCommands?: ProjectLaunchCommand[];
  launchCommandsLoading?: boolean;
  launchCommandsFailed?: boolean;
  onRunLaunchCommand?: (command: ProjectLaunchCommand) => void;
  onRunQuickAction?: (action: QuickAction) => void;
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
  kind?: 'action' | 'open-in' | 'launch-commands';
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
  if (actions.onMovePath) {
    items.push({
      key: 'move-path',
      group: 2,
      icon: FolderPen,
      label: t('sidebar.moveProjectPath.menuLabel'),
      onSelect: actions.onMovePath,
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
  if (actions.onOpenArchivedTasks) {
    items.push({
      key: 'open-archived-tasks',
      group: 4,
      icon: ArchiveRestore,
      label: t('sidebar.openArchivedTasks'),
      onSelect: actions.onOpenArchivedTasks,
    });
  }
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
      key: 'launch-commands',
      group: 5,
      kind: 'launch-commands',
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

function ProjectLaunchCommandsContextSubmenu({ actions }: { actions: ProjectMenuActions }) {
  const { t } = useTranslation();
  const quickActions = actions.quickActions ?? [];
  const launchCommands = (actions.launchCommands ?? []).filter(
    (command) => !quickActions.some((action) => action.command.trim() === command.command)
  );
  const hasCommands = launchCommands.length > 0 || quickActions.length > 0;
  return (
    <ContextMenuSub>
      <ContextMenuSubTrigger>
        <Play className="size-4" />
        {t('sidebar.captureAutomation.menuLabel')}
      </ContextMenuSubTrigger>
      <ContextMenuSubContent className="min-w-72 max-w-96">
        {actions.launchCommandsLoading && launchCommands.length === 0 ? (
          <ContextMenuItem disabled>
            <Loader2 className="size-4 animate-spin" />
            {t('sidebar.captureAutomation.loadingCommands')}
          </ContextMenuItem>
        ) : null}
        {launchCommands.length > 0 ? (
          <ContextMenuGroup>
            <ContextMenuLabel>{t('sidebar.captureAutomation.detectedCommands')}</ContextMenuLabel>
            {launchCommands.map((command) => (
              <ContextMenuItem
                key={command.id}
                disabled={!actions.onRunLaunchCommand}
                onClick={(event) => {
                  event.stopPropagation();
                  actions.onRunLaunchCommand?.(command);
                }}
              >
                <Play className="size-4" />
                <span className="flex min-w-0 flex-col">
                  <span className="truncate">{command.label}</span>
                  <span className="truncate font-mono text-[10px] text-foreground-passive">
                    {command.command}
                  </span>
                </span>
              </ContextMenuItem>
            ))}
          </ContextMenuGroup>
        ) : null}
        {quickActions.length > 0 ? (
          <>
            {launchCommands.length > 0 ? <ContextMenuSeparator /> : null}
            <ContextMenuGroup>
              <ContextMenuLabel>{t('sidebar.captureAutomation.savedCommands')}</ContextMenuLabel>
              {quickActions.map((action) => (
                <ContextMenuItem
                  key={action.id}
                  disabled={!actions.onRunQuickAction}
                  onClick={(event) => {
                    event.stopPropagation();
                    actions.onRunQuickAction?.(action);
                  }}
                >
                  <Play className="size-4" />
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate">{action.label}</span>
                    <span className="truncate font-mono text-[10px] text-foreground-passive">
                      {action.command}
                    </span>
                  </span>
                </ContextMenuItem>
              ))}
            </ContextMenuGroup>
          </>
        ) : null}
        {!actions.launchCommandsLoading && actions.launchCommandsFailed ? (
          <ContextMenuItem disabled>
            {t('sidebar.captureAutomation.loadCommandsFailed')}
          </ContextMenuItem>
        ) : null}
        {!actions.launchCommandsLoading && !actions.launchCommandsFailed && !hasCommands ? (
          <ContextMenuItem disabled>{t('sidebar.captureAutomation.noCommands')}</ContextMenuItem>
        ) : null}
        <ContextMenuSeparator />
        <ContextMenuItem
          onClick={(event) => {
            event.stopPropagation();
            actions.onCaptureAutomation?.();
          }}
        >
          <WandSparkles className="size-4" />
          {t('sidebar.captureAutomation.createLabel')}
        </ContextMenuItem>
        <ContextMenuItem
          onClick={(event) => {
            event.stopPropagation();
            actions.onManageQuickActions?.();
          }}
        >
          <Settings2 className="size-4" />
          {t('projects.quickActions.manage')}
        </ContextMenuItem>
      </ContextMenuSubContent>
    </ContextMenuSub>
  );
}

function ProjectLaunchCommandsDropdownSubmenu({ actions }: { actions: ProjectMenuActions }) {
  const { t } = useTranslation();
  const quickActions = actions.quickActions ?? [];
  const launchCommands = (actions.launchCommands ?? []).filter(
    (command) => !quickActions.some((action) => action.command.trim() === command.command)
  );
  const hasCommands = launchCommands.length > 0 || quickActions.length > 0;
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <Play className="size-4" />
        {t('sidebar.captureAutomation.menuLabel')}
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="min-w-72 max-w-96">
        {actions.launchCommandsLoading && launchCommands.length === 0 ? (
          <DropdownMenuItem disabled>
            <Loader2 className="size-4 animate-spin" />
            {t('sidebar.captureAutomation.loadingCommands')}
          </DropdownMenuItem>
        ) : null}
        {launchCommands.length > 0 ? (
          <DropdownMenuGroup>
            <DropdownMenuLabel>{t('sidebar.captureAutomation.detectedCommands')}</DropdownMenuLabel>
            {launchCommands.map((command) => (
              <DropdownMenuItem
                key={command.id}
                disabled={!actions.onRunLaunchCommand}
                onClick={(event) => {
                  event.stopPropagation();
                  actions.onRunLaunchCommand?.(command);
                }}
              >
                <Play className="size-4" />
                <span className="flex min-w-0 flex-col">
                  <span className="truncate">{command.label}</span>
                  <span className="truncate font-mono text-[10px] text-foreground-passive">
                    {command.command}
                  </span>
                </span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
        ) : null}
        {quickActions.length > 0 ? (
          <>
            {launchCommands.length > 0 ? <DropdownMenuSeparator /> : null}
            <DropdownMenuGroup>
              <DropdownMenuLabel>{t('sidebar.captureAutomation.savedCommands')}</DropdownMenuLabel>
              {quickActions.map((action) => (
                <DropdownMenuItem
                  key={action.id}
                  disabled={!actions.onRunQuickAction}
                  onClick={(event) => {
                    event.stopPropagation();
                    actions.onRunQuickAction?.(action);
                  }}
                >
                  <Play className="size-4" />
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate">{action.label}</span>
                    <span className="truncate font-mono text-[10px] text-foreground-passive">
                      {action.command}
                    </span>
                  </span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          </>
        ) : null}
        {!actions.launchCommandsLoading && actions.launchCommandsFailed ? (
          <DropdownMenuItem disabled>
            {t('sidebar.captureAutomation.loadCommandsFailed')}
          </DropdownMenuItem>
        ) : null}
        {!actions.launchCommandsLoading && !actions.launchCommandsFailed && !hasCommands ? (
          <DropdownMenuItem disabled>{t('sidebar.captureAutomation.noCommands')}</DropdownMenuItem>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={(event) => {
            event.stopPropagation();
            actions.onCaptureAutomation?.();
          }}
        >
          <WandSparkles className="size-4" />
          {t('sidebar.captureAutomation.createLabel')}
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={(event) => {
            event.stopPropagation();
            actions.onManageQuickActions?.();
          }}
        >
          <Settings2 className="size-4" />
          {t('projects.quickActions.manage')}
        </DropdownMenuItem>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

interface ProjectContextMenuProps extends ProjectMenuActions {
  children: React.ReactNode;
}

export function ProjectContextMenu({ children, ...actions }: ProjectContextMenuProps) {
  const items = useMenuItems(actions);
  return (
    <ContextMenu
      onOpenChange={(open) => {
        if (open) actions.onMenuOpen?.();
      }}
    >
      <ContextMenuTrigger className="block w-full min-w-0 overflow-hidden">
        {children}
      </ContextMenuTrigger>
      <ContextMenuContent>
        {items.map((item, index) => {
          const prev = items[index - 1];
          const showSeparator = prev && prev.group !== item.group;
          const workspaceAssign = item.key === 'remove-project' ? actions.onAssignWorkspace : null;
          if (item.kind === 'launch-commands') {
            return (
              <React.Fragment key={item.key}>
                {showSeparator && <ContextMenuSeparator />}
                <ProjectLaunchCommandsContextSubmenu actions={actions} />
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
    <DropdownMenu
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen) actions.onMenuOpen?.();
        onOpenChange?.(nextOpen);
      }}
    >
      <DropdownMenuTrigger render={trigger} />
      <DropdownMenuContent align={align} className="min-w-44">
        {items.map((item, index) => {
          const prev = items[index - 1];
          const showSeparator = prev && prev.group !== item.group;
          const workspaceAssign = item.key === 'remove-project' ? actions.onAssignWorkspace : null;
          if (item.kind === 'launch-commands') {
            return (
              <React.Fragment key={item.key}>
                {showSeparator && <DropdownMenuSeparator />}
                <ProjectLaunchCommandsDropdownSubmenu actions={actions} />
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
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
