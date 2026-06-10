import type { TFunction } from 'i18next';
import {
  Archive,
  ArchiveRestore,
  CircleDot,
  CircleSlash,
  ClipboardList,
  Copy,
  Info,
  Link2,
  Pencil,
  Pin,
  PinOff,
  RefreshCw,
  RotateCcw,
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

interface TaskMenuActions extends TaskMenuInfoFields {
  isPinned: boolean;
  canPin: boolean;
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
  onMarkNeedsReview: () => void;
  onUnmarkNeedsReview: () => void;
  onRename: () => void;
  /**
   * Archive the task. Opens a dialog for an optional note; confirming there
   * performs the archive. The pre-archive skill is session-level only and never
   * runs here.
   */
  onArchive: () => void;
  onCopyYodaLink?: () => void;
  onRestore?: () => void;
  onReconnect?: () => void;
  /** Restart the session. Pass a tmux override to force tmux on/off for this restart only. */
  onRestartSession?: (tmuxOverride?: boolean) => void;
  /** Current sidebar workspace assignment (null = default). Projectless tasks only. */
  currentWorkspaceId?: string | null;
  /** Assign this task to a sidebar workspace, or null for the default. */
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

function useMenuItems(actions: TaskMenuActions): MenuItemDescriptor[] {
  const { t } = useTranslation();
  const items: MenuItemDescriptor[] = [];

  // group 0 — open details (standalone)
  if (actions.onOpenDetails) {
    items.push({
      key: 'open-details',
      group: 0,
      icon: Info,
      label: actions.openDetailsLabel ?? t('tasks.context.openDetails'),
      onSelect: actions.onOpenDetails,
    });
  }

  // group 1 — pin, archive / restore, mark-review. The default archive opens a
  // dialog for an optional note; confirming there performs the archive. The
  // pre-archive skill only makes sense at the session (conversation) level, so it
  // is never offered here.
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
  if (!actions.isArchived) {
    items.push({
      key: 'archive',
      group: 1,
      icon: Archive,
      label: t('tasks.context.archive'),
      onSelect: actions.onArchive,
    });
  }
  if (actions.isArchived && actions.onRestore) {
    items.push({
      key: 'restore',
      group: 1,
      icon: ArchiveRestore,
      label: t('projects.tasks.restore'),
      onSelect: actions.onRestore,
    });
  }
  if (actions.canMarkReview) {
    items.push(
      actions.needsReview
        ? {
            key: 'unmark-review',
            group: 1,
            icon: CircleSlash,
            label: t('tasks.context.unmarkReview'),
            onSelect: actions.onUnmarkNeedsReview,
          }
        : {
            key: 'mark-review',
            group: 1,
            icon: CircleDot,
            label: t('tasks.context.markForReview'),
            onSelect: actions.onMarkNeedsReview,
          }
    );
  }

  // group 2 — rename
  items.push({
    key: 'rename',
    group: 2,
    icon: Pencil,
    label: t('common.rename'),
    onSelect: actions.onRename,
  });

  // group 3 — copy (ID first)
  if (actions.taskId) {
    items.push({
      key: 'copy-task-id',
      group: 3,
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
      group: 3,
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
      group: 3,
      icon: Link2,
      label: t('tasks.context.copyYodaLink'),
      onSelect: actions.onCopyYodaLink,
    });
  }

  // group 4 — session: reconnect
  if (actions.onReconnect) {
    items.push({
      key: 'reconnect',
      group: 4,
      icon: RotateCcw,
      label: t('sidebar.reconnect'),
      onSelect: actions.onReconnect,
    });
  }

  // group 5 — reopen / reload (standalone, last)
  if (actions.onRestartSession) {
    items.push({
      key: 'reopen',
      group: 5,
      icon: RefreshCw,
      label: t('tasks.context.reopenTask'),
      onSelect: () => actions.onRestartSession?.(),
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

interface TaskContextMenuProps extends TaskMenuActions {
  children: React.ReactNode;
}

export function TaskContextMenu({ children, ...actions }: TaskContextMenuProps) {
  const items = useMenuItems(actions);
  return (
    <ContextMenu>
      <ContextMenuTrigger>{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-max overflow-x-visible">
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
                className="whitespace-nowrap"
              >
                <Icon className="size-4" />
                {item.label}
              </ContextMenuItem>
            </React.Fragment>
          );
        })}
        {actions.onAssignWorkspace && (
          <WorkspaceAssignContextSubmenu
            currentWorkspaceId={actions.currentWorkspaceId ?? null}
            onAssign={actions.onAssignWorkspace}
          />
        )}
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
      <DropdownMenuContent align={align} className="w-max min-w-44 overflow-x-visible">
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
                className="whitespace-nowrap"
              >
                <Icon className="size-4" />
                {item.label}
              </DropdownMenuItem>
            </React.Fragment>
          );
        })}
        {actions.onAssignWorkspace && (
          <WorkspaceAssignDropdownSubmenu
            currentWorkspaceId={actions.currentWorkspaceId ?? null}
            onAssign={actions.onAssignWorkspace}
          />
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
