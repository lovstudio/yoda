import type { TFunction } from 'i18next';
import {
  Activity,
  Archive,
  ArchiveRestore,
  CircleDot,
  CircleSlash,
  ClipboardList,
  Copy,
  FileText,
  FolderInput,
  Info,
  Link2,
  Pencil,
  Pin,
  PinOff,
  PlayCircle,
  RefreshCw,
  RotateCcw,
  Settings2,
} from 'lucide-react';
import { observer } from 'mobx-react-lite';
import React from 'react';
import { useTranslation } from 'react-i18next';
import type { AgentProviderId } from '@shared/agent-provider-registry';
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
import { buildTaskBasicInfo, type TaskBasicInfoFields } from './task-menu-basic-info';

interface TaskSessionInfoFields {
  providerId?: AgentProviderId;
  sessionId?: string;
  sessionTitle?: string;
  providerName?: string;
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
  /** Archive the task. The pre-archive skill is session-level only and never runs here. */
  onArchive: () => void;
  onArchiveWithNote?: () => void;
  onCopyYodaLink?: () => void;
  onRestore?: () => void;
  onReconnect?: () => void;
  /** Restart the session. Pass a tmux override to force tmux on/off for this restart only. */
  onRestartSession?: (tmuxOverride?: boolean) => void;
  onRunScript?: () => void;
  canRunScript?: boolean;
  onConfigureScripts?: () => void;
  onViewStatus?: () => void;
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

  // group 0 — task management: pin, rename, mark-review
  if (actions.canPin) {
    items.push(
      actions.isPinned
        ? {
            key: 'unpin',
            group: 0,
            icon: PinOff,
            label: t('tasks.context.unpinTask'),
            onSelect: actions.onUnpin,
          }
        : {
            key: 'pin',
            group: 0,
            icon: Pin,
            label: t('tasks.context.pinTask'),
            onSelect: actions.onPin,
          }
    );
  }
  items.push({
    key: 'rename',
    group: 0,
    icon: Pencil,
    label: t('common.rename'),
    onSelect: actions.onRename,
  });
  if (actions.canMarkReview) {
    items.push(
      actions.needsReview
        ? {
            key: 'unmark-review',
            group: 0,
            icon: CircleSlash,
            label: t('tasks.context.unmarkReview'),
            onSelect: actions.onUnmarkNeedsReview,
          }
        : {
            key: 'mark-review',
            group: 0,
            icon: CircleDot,
            label: t('tasks.context.markForReview'),
            onSelect: actions.onMarkNeedsReview,
          }
    );
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

  // group 1 — copy (ID first)
  if (actions.taskId) {
    items.push({
      key: 'copy-task-id',
      group: 1,
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
      group: 1,
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
      group: 1,
      icon: Link2,
      label: t('tasks.context.copyYodaLink'),
      onSelect: actions.onCopyYodaLink,
    });
  }

  // group 2 — archive / restore. The pre-archive skill only makes sense at the
  // session (conversation) level, where it runs against a specific session before
  // archiving it. A task spans many sessions, so it is offered only in the
  // conversation tab context menu — never here.
  if (!actions.isArchived) {
    items.push({
      key: 'archive',
      group: 2,
      icon: Archive,
      label: t('tasks.context.archive'),
      onSelect: actions.onArchive,
    });
    if (actions.onArchiveWithNote) {
      items.push({
        key: 'archive-with-note',
        group: 2,
        icon: FileText,
        label: t('tasks.context.archiveWithNote'),
        onSelect: actions.onArchiveWithNote,
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

  // group 3 — run scripts
  if (actions.onRunScript) {
    items.push({
      key: 'run-script',
      group: 3,
      icon: PlayCircle,
      label: t('sidebar.runScripts.runScript'),
      onSelect: actions.onRunScript,
      disabled: actions.canRunScript === false,
    });
  }
  if (actions.onViewStatus) {
    items.push({
      key: 'view-status',
      group: 3,
      icon: Activity,
      label: t('sidebar.runScripts.scriptStatus'),
      onSelect: actions.onViewStatus,
    });
  }
  if (actions.onConfigureScripts) {
    items.push({
      key: 'configure-scripts',
      group: 3,
      icon: Settings2,
      label: t('sidebar.runScripts.configure'),
      onSelect: actions.onConfigureScripts,
    });
  }

  // group 4 — session: open details, reconnect
  if (actions.onOpenDetails) {
    items.push({
      key: 'open-details',
      group: 4,
      icon: Info,
      label: actions.openDetailsLabel ?? t('tasks.context.openDetails'),
      onSelect: actions.onOpenDetails,
    });
  }
  if (actions.onReconnect) {
    items.push({
      key: 'reconnect',
      group: 4,
      icon: RotateCcw,
      label: t('sidebar.reconnect'),
      onSelect: actions.onReconnect,
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
    if (fields.providerId === 'claude') {
      const context = await rpc.conversations.getClaudeSessionContext(cwd, sessionId);
      return context?.transcriptPath;
    }
    if (fields.providerId === 'codex') {
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

const TaskWorkspaceContextSubmenu = observer(function TaskWorkspaceContextSubmenu({
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
        <ContextMenuSubTrigger className="whitespace-nowrap">
          <FolderInput className="size-4" />
          {t('workspaces.moveToWorkspace')}
        </ContextMenuSubTrigger>
        <ContextMenuSubContent>
          <ContextMenuRadioGroup value={currentWorkspaceId ?? ALL_WORKSPACES_ID}>
            <ContextMenuRadioItem value={ALL_WORKSPACES_ID} onClick={() => onAssign(null)}>
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

const TaskWorkspaceDropdownSubmenu = observer(function TaskWorkspaceDropdownSubmenu({
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
        <DropdownMenuSubTrigger className="whitespace-nowrap">
          <FolderInput className="size-4" />
          {t('workspaces.moveToWorkspace')}
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent>
          <DropdownMenuRadioGroup value={currentWorkspaceId ?? ALL_WORKSPACES_ID}>
            <DropdownMenuRadioItem value={ALL_WORKSPACES_ID} onClick={() => onAssign(null)}>
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
          <TaskWorkspaceContextSubmenu
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
          <TaskWorkspaceDropdownSubmenu
            currentWorkspaceId={actions.currentWorkspaceId ?? null}
            onAssign={actions.onAssignWorkspace}
          />
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
