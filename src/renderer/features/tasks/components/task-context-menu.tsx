import type { TFunction } from 'i18next';
import {
  Archive,
  ArchiveRestore,
  Bookmark,
  CircleDot,
  CircleSlash,
  ClipboardList,
  Columns2,
  Copy,
  FolderTree,
  Info,
  LayoutGrid,
  Link2,
  ListPlus,
  ListTree,
  Pencil,
  Pin,
  PinOff,
  RefreshCw,
  RotateCcw,
  Sparkles,
  Star,
  StarOff,
} from 'lucide-react';
import React from 'react';
import { useTranslation } from 'react-i18next';
import type { RuntimeId } from '@shared/runtime-registry';
import {
  WorkspaceAssignContextSubmenu,
  WorkspaceAssignDropdownSubmenu,
} from '@renderer/features/workspaces/workspace-assign-submenu';
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
import {
  MoveToProjectContextSubmenu,
  MoveToProjectDropdownSubmenu,
} from './move-to-project-submenu';
import { buildTaskBasicInfo, type TaskBasicInfoFields } from './task-menu-basic-info';

interface TaskSessionInfoFields {
  runtimeId?: RuntimeId;
  sessionId?: string;
  sessionTitle?: string;
  runtimeName?: string;
  resumeCommand?: string;
  running?: boolean;
  tmuxEnabled?: boolean;
}

interface TaskMenuInfoFields extends TaskBasicInfoFields, TaskSessionInfoFields {
  projectPath?: string;
  workingDirectory?: string;
}

export interface TaskMenuActions extends TaskMenuInfoFields {
  isPinned: boolean;
  canPin: boolean;
  isFavorite: boolean;
  canFavorite: boolean;
  isLongTerm: boolean;
  canMarkLongTerm: boolean;
  isArchived: boolean;
  needsReview: boolean;
  canMarkReview: boolean;
  resolveSessionInfo?: () =>
    | TaskSessionInfoFields
    | undefined
    | Promise<TaskSessionInfoFields | undefined>;
  openDetailsLabel?: string;
  onOpenDetails?: () => void;
  onPin: () => void;
  onUnpin: () => void;
  onFavorite: () => void;
  onUnfavorite: () => void;
  onMarkLongTerm: () => void;
  onUnmarkLongTerm: () => void;
  onMarkNeedsReview: () => void;
  onUnmarkNeedsReview: () => void;
  onRename: () => void;
  /** Archive immediately with no skill, note, or dialog. */
  onArchiveQuick: () => void;
  /** Archive the task directly with no skill, note, or dialog. */
  onArchive: () => void;
  /**
   * Open the configurable archive dialog: optional note plus an editable
   * pre-archive command that runs against every live session before archiving.
   */
  onArchiveWithSkill?: () => void;
  onCopyYodaLink?: () => void;
  onRestore?: () => void;
  onReconnect?: () => void;
  /** Restart the session. Pass a tmux override to force tmux on/off for this restart only. */
  onRestartSession?: (tmuxOverride?: boolean) => void;
  /** Current sidebar workspace assignment (null = default). Projectless tasks only. */
  currentWorkspaceId?: string | null;
  /** Assign this task to a sidebar workspace, or null for the default. */
  onAssignWorkspace?: (workspaceId: string | null) => void;
  /** Add an existing or new session-less task under this one. */
  onCreateSubtask?: () => void;
  /** Create a child task and start its first Agent session. */
  onCreateSubtaskAndRun?: () => void;
  /** Open the parent-task picker for this task. */
  onSetParent?: () => void;
  /** Create a new session-less grouping parent and nest this task under it. */
  onCreateParent?: () => void;
  /** Show this task in an extra pane beside the routed task. */
  onOpenBeside?: () => void;
  /** Tile all of this task's children (compare candidates) side by side. */
  onTileCandidates?: () => void;
  /**
   * Re-home this task under another project (move / "promote" a Default task).
   * Only set for eligible tasks (no worktree, no subtasks).
   */
  onMoveToProject?: (targetProjectId: string) => void;
  /** Create a project and move this task into it. */
  onCreateProject?: (defaultName?: string) => void;
}

interface MenuItemDescriptor {
  key: string;
  group: number;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onSelect?: () => void;
  disabled?: boolean;
  variant?: 'default' | 'destructive';
}

function useMenuItems(actions: TaskMenuActions): MenuItemDescriptor[] {
  const { t } = useTranslation();
  const items: MenuItemDescriptor[] = [];

  // group 0 — open / reload
  if (actions.onOpenDetails) {
    items.push({
      key: 'open-details',
      group: 0,
      icon: Info,
      label: actions.openDetailsLabel ?? t('tasks.context.openDetails'),
      onSelect: actions.onOpenDetails,
    });
  }
  if (actions.onOpenBeside) {
    items.push({
      key: 'open-beside',
      group: 0,
      icon: Columns2,
      label: t('tasks.context.openBeside'),
      onSelect: actions.onOpenBeside,
    });
  }
  if (actions.onRestartSession) {
    items.push({
      key: 'reopen',
      group: 0,
      icon: RefreshCw,
      label: t('tasks.context.reopenTask'),
      onSelect: () => actions.onRestartSession?.(),
    });
  }
  if (actions.onTileCandidates) {
    items.push({
      key: 'tile-candidates',
      group: 0,
      icon: LayoutGrid,
      label: t('tasks.context.tileCandidates'),
      onSelect: actions.onTileCandidates,
    });
  }
  if (actions.onReconnect) {
    items.push({
      key: 'reconnect',
      group: 0,
      icon: RotateCcw,
      label: t('sidebar.reconnect'),
      onSelect: actions.onReconnect,
    });
  }

  // group 1 — rename, independent task markers
  items.push({
    key: 'rename',
    group: 1,
    icon: Pencil,
    label: t('common.rename'),
    onSelect: actions.onRename,
  });
  if (actions.canPin) {
    items.push(
      actions.isPinned
        ? {
            key: 'unpin',
            group: 1,
            icon: PinOff,
            label: t('tasks.context.unpinTask'),
            onSelect: actions.onUnpin,
          }
        : {
            key: 'pin',
            group: 1,
            icon: Pin,
            label: t('tasks.context.pinTask'),
            onSelect: actions.onPin,
          }
    );
  }
  if (actions.canFavorite) {
    items.push(
      actions.isFavorite
        ? {
            key: 'unfavorite',
            group: 1,
            icon: StarOff,
            label: t('tasks.context.unfavoriteTask'),
            onSelect: actions.onUnfavorite,
          }
        : {
            key: 'favorite',
            group: 1,
            icon: Star,
            label: t('tasks.context.favoriteTask'),
            onSelect: actions.onFavorite,
          }
    );
  }
  if (actions.canMarkLongTerm) {
    items.push({
      key: actions.isLongTerm ? 'unmark-long-term' : 'mark-long-term',
      group: 1,
      icon: Bookmark,
      label: t(actions.isLongTerm ? 'tasks.context.unmarkLongTerm' : 'tasks.context.markLongTerm'),
      onSelect: actions.isLongTerm ? actions.onUnmarkLongTerm : actions.onMarkLongTerm,
    });
  }
  // group 2 — pending acceptance, then archive / restore. Archive is a flat
  // pair: direct archive (note dialog, no skill) and, when configured, run the
  // pre-archive skill then archive.
  if (actions.canMarkReview) {
    items.push(
      actions.needsReview
        ? {
            key: 'unmark-review',
            group: 2,
            icon: CircleSlash,
            label: t('tasks.context.unmarkReview'),
            onSelect: actions.onUnmarkNeedsReview,
          }
        : {
            key: 'mark-review',
            group: 2,
            icon: CircleDot,
            label: t('tasks.context.markForReview'),
            onSelect: actions.onMarkNeedsReview,
          }
    );
  }
  if (!actions.isArchived) {
    items.push({
      key: 'archive',
      group: 2,
      icon: Archive,
      label: t('tasks.context.archiveDirect'),
      onSelect: actions.onArchive,
    });
    if (actions.onArchiveWithSkill) {
      // The configurable dialog owns the optional note and editable pre-archive
      // command, so it stays enabled even when no preset exists yet.
      items.push({
        key: 'archive-with-skill',
        group: 2,
        icon: Sparkles,
        label: t('tasks.context.archiveOptions'),
        onSelect: actions.onArchiveWithSkill,
      });
    }
  }
  if (actions.isArchived && actions.onRestore) {
    items.push({
      key: 'restore',
      group: 2,
      icon: ArchiveRestore,
      label: t('projects.tasks.restore'),
      onSelect: actions.onRestore,
    });
  }

  // group 3 — task hierarchy
  if (!actions.isArchived && actions.onCreateSubtask) {
    items.push({
      key: 'create-subtask',
      group: 3,
      icon: ListPlus,
      label: t('tasks.context.createSubtask'),
      onSelect: actions.onCreateSubtask,
    });
  }
  if (!actions.isArchived && actions.onCreateSubtaskAndRun) {
    items.push({
      key: 'create-subtask-and-run',
      group: 3,
      icon: Sparkles,
      label: t('tasks.context.createSubtaskAndRun'),
      onSelect: actions.onCreateSubtaskAndRun,
    });
  }
  if (!actions.isArchived && actions.onSetParent) {
    items.push({
      key: 'set-parent',
      group: 3,
      icon: ListTree,
      label: t('tasks.context.setParent'),
      onSelect: actions.onSetParent,
    });
  }
  if (!actions.isArchived && actions.onCreateParent) {
    items.push({
      key: 'create-parent',
      group: 3,
      icon: FolderTree,
      label: t('tasks.context.createParent'),
      onSelect: actions.onCreateParent,
    });
  }

  // group 4 — copy (ID first)
  if (actions.taskId) {
    items.push({
      key: 'copy-task-id',
      group: 4,
      icon: Copy,
      label: t('tasks.context.copyTaskId'),
      onSelect: () => {
        void copyTaskId(actions, t);
      },
    });
  }
  if (actions.taskId || actions.taskName) {
    items.push({
      key: 'copy-task-basic-info',
      group: 4,
      icon: ClipboardList,
      label: t('tasks.context.copyTaskBasicInfo'),
      onSelect: () => {
        void copyTaskBasicInfo(actions, t);
      },
    });
  }
  if (actions.onCopyYodaLink) {
    items.push({
      key: 'copy-yoda-link',
      group: 4,
      icon: Link2,
      label: t('tasks.context.copyYodaLink'),
      onSelect: actions.onCopyYodaLink,
    });
  }

  return items;
}

async function copyTaskBasicInfo(actions: TaskMenuActions, t: TFunction): Promise<void> {
  try {
    const fields = await resolveOptionalSessionInfoFields(actions);
    const contentSourcePath = await resolveSessionContentSourcePath(fields);
    const value = buildTaskBasicInfo(
      {
        ...fields,
        contentSourcePath,
      },
      {
        provider: t('tasks.context.taskInfo.provider'),
        project: t('tasks.context.taskInfo.project'),
        projectPath: t('tasks.context.taskInfo.projectPath'),
        task: t('tasks.context.taskInfo.task'),
        taskId: t('tasks.context.taskInfo.taskId'),
        branch: t('tasks.context.taskInfo.branch'),
        sessionId: t('tasks.context.taskInfo.sessionId'),
        contentSource: t('tasks.context.taskInfo.contentSource'),
        readInstruction: t('tasks.context.taskInfo.readInstruction'),
        readInstructionValue: t('tasks.context.taskInfo.readInstructionValue'),
      }
    );

    if (!value) {
      showCopyFailure(t);
      return;
    }

    await copyText(value, t, {
      success: t('tasks.context.taskBasicInfoCopied'),
      failure: t('tasks.context.copyFailed'),
    });
  } catch {
    showCopyFailure(t);
  }
}

export async function copyTaskLink(link: string, t: TFunction): Promise<void> {
  await copyText(link, t, {
    success: t('tasks.context.yodaLinkCopied'),
    failure: t('tasks.context.copyFailed'),
  });
}

async function copyTaskId(actions: TaskMenuActions, t: TFunction): Promise<void> {
  try {
    const taskId = actions.taskId?.trim();
    if (!taskId) {
      showCopyFailure(t);
      return;
    }

    await copyText(taskId, t, {
      success: t('tasks.context.taskIdCopied'),
      failure: t('tasks.context.copyFailed'),
    });
  } catch {
    showCopyFailure(t);
  }
}

async function resolveOptionalSessionInfoFields(
  actions: TaskMenuActions
): Promise<TaskMenuInfoFields> {
  try {
    return await resolveSessionInfoFields(actions);
  } catch {
    return actions;
  }
}

async function resolveSessionInfoFields(actions: TaskMenuActions): Promise<TaskMenuInfoFields> {
  const resolved = await actions.resolveSessionInfo?.();
  return { ...actions, ...(resolved ?? {}) };
}

async function resolveSessionContentSourcePath(
  fields: TaskMenuInfoFields
): Promise<string | undefined> {
  const cwd = firstTrimmed(fields.workingDirectory, fields.projectPath);
  const sessionId = fields.sessionId?.trim();
  if (!cwd || !sessionId) return undefined;

  try {
    if (fields.runtimeId === 'claude') {
      const context = await rpc.conversations.getClaudeSessionContext(cwd, sessionId);
      return context?.transcriptPath;
    }
    if (fields.runtimeId === 'codex') {
      const context = await rpc.conversations.getCodexSessionContext(
        cwd,
        sessionId,
        fields.sessionTitle
      );
      return context?.rolloutPath ?? undefined;
    }
  } catch {
    return undefined;
  }

  return undefined;
}

function firstTrimmed(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) return trimmed;
  }
  return undefined;
}

async function copyText(
  value: string,
  t: TFunction,
  messages: { success: string; failure: string }
) {
  try {
    await navigator.clipboard.writeText(value);
    toast({ title: messages.success });
  } catch {
    toast({
      title: t('auth.copyFailed'),
      description: messages.failure,
      variant: 'destructive',
    });
  }
}

function showCopyFailure(t: TFunction): void {
  toast({
    title: t('auth.copyFailed'),
    description: t('tasks.context.copyFailed'),
    variant: 'destructive',
  });
}

function stopTaskDragGesture(event: React.SyntheticEvent): void {
  // Menu popups are portaled into document.body, but React still bubbles their
  // events through the owning task row where dnd-kit installs its drag sensor.
  event.stopPropagation();
}

interface TaskContextMenuProps extends TaskMenuActions {
  children: React.ReactNode;
  onOpenChange?: (open: boolean) => void;
}

/**
 * The task menu's items without the surrounding context-menu wrapper, for
 * surfaces that compose the task entity's actions into a larger menu (e.g.
 * the top-level tab strip, which appends tab placement and close groups).
 */
export function TaskContextMenuItems(actions: TaskMenuActions) {
  const items = useMenuItems(actions);
  return (
    <>
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
                item.onSelect?.();
              }}
              className="whitespace-nowrap"
            >
              <Icon className="size-4" />
              {item.label}
            </ContextMenuItem>
          </React.Fragment>
        );
      })}
      {actions.onMoveToProject && actions.projectId && (
        <MoveToProjectContextSubmenu
          currentProjectId={actions.projectId}
          onMove={actions.onMoveToProject}
          onCreateProject={actions.onCreateProject}
        />
      )}
      {actions.onAssignWorkspace && (
        <WorkspaceAssignContextSubmenu
          currentWorkspaceId={actions.currentWorkspaceId ?? null}
          onAssign={actions.onAssignWorkspace}
          showSeparator={!actions.onMoveToProject || !actions.projectId}
        />
      )}
    </>
  );
}

export function TaskContextMenu({ children, onOpenChange, ...actions }: TaskContextMenuProps) {
  return (
    <ContextMenu onOpenChange={onOpenChange}>
      <ContextMenuTrigger>{children}</ContextMenuTrigger>
      <ContextMenuContent
        className="w-max overflow-x-visible"
        onPointerDown={stopTaskDragGesture}
        onMouseDown={stopTaskDragGesture}
      >
        <TaskContextMenuItems {...actions} />
      </ContextMenuContent>
    </ContextMenu>
  );
}

interface TaskActionsMenuProps extends TaskMenuActions {
  trigger: React.ReactElement;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  align?: 'start' | 'center' | 'end';
}

export function TaskActionsMenu({
  trigger,
  open,
  onOpenChange,
  align = 'end',
  ...actions
}: TaskActionsMenuProps) {
  const items = useMenuItems(actions);
  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger render={trigger} />
      <DropdownMenuContent
        align={align}
        className="w-max min-w-44 overflow-x-visible"
        onPointerDown={stopTaskDragGesture}
        onMouseDown={stopTaskDragGesture}
      >
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
                  item.onSelect?.();
                }}
                className="whitespace-nowrap"
              >
                <Icon className="size-4" />
                {item.label}
              </DropdownMenuItem>
            </React.Fragment>
          );
        })}
        {actions.onMoveToProject && actions.projectId && (
          <MoveToProjectDropdownSubmenu
            currentProjectId={actions.projectId}
            onMove={actions.onMoveToProject}
            onCreateProject={actions.onCreateProject}
          />
        )}
        {actions.onAssignWorkspace && (
          <WorkspaceAssignDropdownSubmenu
            currentWorkspaceId={actions.currentWorkspaceId ?? null}
            onAssign={actions.onAssignWorkspace}
            showSeparator={!actions.onMoveToProject || !actions.projectId}
          />
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
