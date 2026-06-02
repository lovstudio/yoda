import { Archive, CircleStop, Loader2, MoreHorizontal } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AGENT_PROVIDER_IDS,
  getProvider,
  isValidProviderId,
  type AgentProviderId,
} from '@shared/agent-provider-registry';
import { selectCurrentPr } from '@shared/pull-requests';
import { getProjectStore } from '@renderer/features/projects/stores/project-selectors';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import { TaskSidebarAgentStatus } from '@renderer/features/sidebar/task-sidebar-agent-status';
import {
  TaskActionsMenu,
  TaskContextMenu,
} from '@renderer/features/tasks/components/task-context-menu';
import { runPreArchiveCommand } from '@renderer/features/tasks/run-pre-archive-command';
import { type TaskStore } from '@renderer/features/tasks/stores/task';
import {
  asProvisioned,
  getTaskManagerStore,
  getTaskStore,
  taskAgentStatus,
} from '@renderer/features/tasks/stores/task-selectors';
import AgentLogo from '@renderer/lib/components/agent-logo';
import { rpc } from '@renderer/lib/ipc';
import {
  useNavigate,
  useParams,
  useWorkspaceSlots,
} from '@renderer/lib/layout/navigation-provider';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { agentConfig } from '@renderer/utils/agentConfig';
import { cn } from '@renderer/utils/utils';
import { PrBadge } from '../../lib/components/pr-badge';
import { SidebarItemMiniButton, SidebarMenuRow } from './sidebar-primitives';

interface SidebarTaskItemProps {
  taskId: string;
  projectId: string;
  /**
   * - `underProject` (default): nested under a project header, deeper indent.
   * - `pinned`: tight padding for the pinned strip.
   * - `flat`: top-level row in the no-grouping / type / activity views; shows the project tag.
   */
  rowVariant?: 'underProject' | 'pinned' | 'flat';
}

export const SidebarTaskItem = observer(function SidebarTaskItem({
  taskId,
  projectId,
  rowVariant = 'underProject',
}: SidebarTaskItemProps) {
  const { t } = useTranslation();
  const { navigate } = useNavigate();
  const showRename = useShowModal('renameTaskModal');
  const showArchiveWithNote = useShowModal('archiveTaskWithNoteModal');
  const showEditPreArchive = useShowModal('editPreArchiveCommandModal');
  const showConfirm = useShowModal('confirmActionModal');
  const showManageRunScripts = useShowModal('manageRunScriptsModal');

  const { currentView } = useWorkspaceSlots();
  const { params } = useParams('task');
  const isActive =
    currentView === 'task' && params.taskId === taskId && params.projectId === projectId;
  const [isMenuOpen, setMenuOpen] = useState(false);

  const task = getTaskStore(projectId, taskId)!;
  const taskManager = getTaskManagerStore(projectId);
  const { value: homeDraft } = useAppSettingsKey('homeDraft');
  const preArchiveCommand = homeDraft?.preArchiveCommand ?? '';
  const [archivePhase, setArchivePhase] = useState<'idle' | 'pre-command' | 'archive'>('idle');
  const preArchiveAbortRef = useRef<AbortController | null>(null);
  const isArchiving = archivePhase !== 'idle';
  const canInterruptArchive = archivePhase === 'pre-command';

  const isBootstrapping =
    task.state === 'unregistered' ||
    (task.state === 'unprovisioned' &&
      (task.phase === 'provision' || task.phase === 'provision-error'));
  const isAgentWorking = taskAgentStatus(task) === 'working';

  const taskName = task.data.name;
  const agentBadges = getSidebarAgentBadges(task.conversationStats);
  const taskIndentClass = rowVariant === 'underProject' ? 'pl-8' : 'pl-2';

  const handleProvision = () => {
    if (task.state !== 'unprovisioned' || task.phase !== 'idle') return;
    void taskManager?.provisionTask(taskId);
  };

  const handleArchive = (options?: { skipPreCommand?: boolean }) => {
    if (canInterruptArchive) {
      preArchiveAbortRef.current?.abort();
      return;
    }
    if (isArchiving) return;
    void (async () => {
      const shouldRunPreCommand = !options?.skipPreCommand && preArchiveCommand.trim().length > 0;
      const abortController = shouldRunPreCommand ? new AbortController() : null;
      try {
        if (abortController) {
          preArchiveAbortRef.current = abortController;
          setArchivePhase('pre-command');
          await runPreArchiveCommand(projectId, taskId, preArchiveCommand, {
            signal: abortController.signal,
          });
          if (abortController.signal.aborted) return;
        }
        if (preArchiveAbortRef.current === abortController) {
          preArchiveAbortRef.current = null;
        }
        setArchivePhase('archive');
        await taskManager?.archiveTask(taskId);
      } finally {
        if (preArchiveAbortRef.current === abortController) {
          preArchiveAbortRef.current = null;
        }
        setArchivePhase('idle');
      }
    })();
  };

  const handleArchiveWithNote = () => {
    showArchiveWithNote({
      projectId,
      taskId,
      taskName,
    });
  };

  const handleRename = () => showRename({ projectId, taskId, currentName: taskName });

  const handleDelete = () =>
    showConfirm({
      title: t('sidebar.deleteTask.title'),
      description: t('sidebar.deleteTask.description', { name: taskName }),
      confirmLabel: t('sidebar.deleteTask.confirmLabel'),
      onSuccess: () => {
        void taskManager?.deleteTask(taskId);
        if (isActive) navigate('project', { projectId });
      },
    });

  const canPin = task.state !== 'unregistered';
  const canMarkReview = task.state !== 'unregistered';
  const needsReview = task.data.needsReview;

  const provisionedTask = asProvisioned(task);
  const branchName =
    provisionedTask?.workspace.git.branchName ??
    ('taskBranch' in task.data ? task.data.taskBranch : undefined);
  const workspace = provisionedTask?.workspace;
  const handleReconnect =
    workspace?.connectionState != null ? () => workspace.reconnect() : undefined;

  const project = getProjectStore(projectId);
  const projectName =
    project?.state === 'unregistered' ? projectId : (project?.displayName ?? projectId);
  const projectPath = project?.data?.path;

  const activeConversationId = provisionedTask?.taskView.tabManager.activeConversationId;
  const activeConversation = activeConversationId
    ? provisionedTask?.conversations.conversations.get(activeConversationId)?.data
    : undefined;
  const resumeCommand = activeConversation
    ? buildResumeCommand({
        providerId: activeConversation.providerId,
        sessionId: activeConversation.id,
        cwd: provisionedTask?.path ?? projectPath,
      })
    : undefined;

  const handleConfigureScripts = () => showManageRunScripts({ projectId, projectName });

  const handleRunScript = () => {
    if (!provisionedTask) {
      navigate('task', { projectId, taskId });
      return;
    }
    void rpc.terminals
      .runLifecycleScript({
        projectId,
        workspaceId: provisionedTask.workspaceId,
        type: 'run',
      })
      .catch(() => {});
  };

  const handleViewStatus = () => {
    navigate('task', { projectId, taskId });
  };

  const handleOpenDetails = () => {
    handleProvision();
    navigate('task', { projectId, taskId });
  };

  const menuActions = {
    isPinned: task.data.isPinned,
    canPin,
    isArchived: false,
    needsReview,
    canMarkReview,
    branchName,
    sessionId: activeConversation?.id,
    projectPath,
    resumeCommand,
    openDetailsLabel: t('sidebar.openSessionDetails'),
    onOpenDetails: handleOpenDetails,
    onPin: () => void task.setPinned(true),
    onUnpin: () => void task.setPinned(false),
    onMarkNeedsReview: () => void task.setNeedsReview(true),
    onUnmarkNeedsReview: () => void task.setNeedsReview(false),
    onRename: handleRename,
    onArchive: () => handleArchive(),
    onArchiveSkipPreCommand: preArchiveCommand.trim()
      ? () => handleArchive({ skipPreCommand: true })
      : undefined,
    onArchiveWithNote: handleArchiveWithNote,
    onConfigurePreArchive: () => showEditPreArchive({}),
    onReconnect: handleReconnect,
    onDelete: handleDelete,
    onRunScript: handleRunScript,
    canRunScript: Boolean(provisionedTask),
    onConfigureScripts: handleConfigureScripts,
    onViewStatus: handleViewStatus,
  };

  return (
    <TaskContextMenu {...menuActions}>
      <SidebarMenuRow
        className={cn(
          'group/row flex items-center justify-between px-1 h-8 gap-1',
          taskIndentClass
        )}
        isActive={isActive}
        onMouseDown={(e) => e.preventDefault()}
        onClick={handleOpenDetails}
        onDoubleClick={(e) => {
          e.stopPropagation();
          handleRename();
        }}
      >
        <div className="flex min-w-0 flex-1 items-center gap-1 self-stretch overflow-hidden">
          <SidebarTaskAgentBadges badges={agentBadges} />
          <span
            className={cn(
              'min-w-0 truncate text-left transition-colors',
              (isBootstrapping || isArchiving) && 'text-foreground/40'
            )}
          >
            {taskName}
          </span>
          {rowVariant === 'flat' && (
            <span className="shrink-0 truncate max-w-[8rem] rounded-sm bg-background-tertiary-2 px-1 text-[10px] uppercase tracking-wide text-foreground-tertiary">
              {projectName}
            </span>
          )}
          <RenderPrBadge task={task} />
        </div>
        <div
          className={cn(
            'items-center gap-0.5',
            isMenuOpen || isArchiving
              ? 'flex'
              : isAgentWorking
                ? 'hidden'
                : 'hidden group-hover/row:flex'
          )}
        >
          <TaskActionsMenu
            {...menuActions}
            open={isMenuOpen}
            onOpenChange={setMenuOpen}
            trigger={
              <SidebarItemMiniButton
                type="button"
                aria-label={t('sidebar.runScripts.menuLabel')}
                onClick={(e) => e.stopPropagation()}
              >
                <MoreHorizontal className="h-4 w-4" />
              </SidebarItemMiniButton>
            }
          />
          <SidebarItemMiniButton
            type="button"
            aria-label={
              canInterruptArchive ? t('sidebar.interruptPreArchive') : t('sidebar.archiveTask')
            }
            className={canInterruptArchive ? 'group/archive-action' : undefined}
            disabled={archivePhase === 'archive'}
            onClick={(e) => {
              e.stopPropagation();
              handleArchive();
            }}
          >
            {canInterruptArchive ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin group-hover/archive-action:hidden" />
                <CircleStop className="hidden h-4 w-4 text-destructive group-hover/archive-action:block" />
              </>
            ) : isArchiving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Archive className="h-4 w-4" />
            )}
          </SidebarItemMiniButton>
        </div>
        <div
          className={cn(
            'items-center',
            isMenuOpen || isArchiving
              ? 'hidden'
              : isAgentWorking
                ? 'flex'
                : 'flex group-hover/row:hidden'
          )}
        >
          <TaskSidebarAgentStatus task={task} needsReview={needsReview} />
        </div>
      </SidebarMenuRow>
    </TaskContextMenu>
  );
});

const RenderPrBadge = observer(function RenderPrBadge({ task }: { task: TaskStore }) {
  if (!('prs' in task.data)) return null;
  const pr = selectCurrentPr(task.data.prs);
  return pr ? <PrBadge variant="compact" pr={pr} /> : null;
});

type SidebarAgentBadge = {
  providerId: AgentProviderId;
  count: number;
};

function getSidebarAgentBadges(stats: Record<string, number>): SidebarAgentBadge[] {
  const counts = new Map<AgentProviderId, number>();
  for (const [providerId, count] of Object.entries(stats)) {
    if (!isValidProviderId(providerId) || count <= 0) continue;
    counts.set(providerId, count);
  }

  return AGENT_PROVIDER_IDS.flatMap((providerId) => {
    const count = counts.get(providerId);
    return count === undefined ? [] : [{ providerId, count }];
  });
}

function shellQuote(value: string): string {
  if (value.length > 0 && /^[A-Za-z0-9_\-./:=@%+,]+$/.test(value)) return value;
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function buildResumeCommand(input: {
  providerId: AgentProviderId;
  sessionId: string;
  cwd?: string;
}): string | undefined {
  const provider = getProvider(input.providerId);
  if (!provider?.cli) return undefined;
  const parts: string[] = [provider.cli];
  parts.push(...(provider.defaultArgs ?? []));
  if (provider.resumeFlag) {
    parts.push(...provider.resumeFlag.split(/\s+/).filter(Boolean));
    if (provider.sessionIdFlag) parts.push(input.sessionId);
  } else if (provider.sessionIdFlag) {
    parts.push(...provider.sessionIdFlag.split(/\s+/).filter(Boolean), input.sessionId);
  } else {
    return undefined;
  }
  const cmd = parts.map(shellQuote).join(' ');
  return input.cwd ? `cd ${shellQuote(input.cwd)} && ${cmd}` : cmd;
}

function SidebarTaskAgentBadges({ badges }: { badges: SidebarAgentBadge[] }) {
  if (badges.length === 0) return null;

  return (
    <div className="flex shrink-0 items-center [&>span:not(:first-child)]:-ml-1">
      {badges.map(({ providerId, count }) => {
        const config = agentConfig[providerId];
        return (
          <span
            key={providerId}
            className="relative flex size-4 items-center justify-center overflow-hidden rounded-sm bg-background-2 ring-1 ring-background"
            title={`${config.name}: ${String(count)}`}
          >
            <AgentLogo
              logo={config.logo}
              alt={config.alt}
              isSvg={config.isSvg}
              invertInDark={config.invertInDark}
              className="size-3"
            />
            {count > 1 && (
              <span className="absolute -bottom-px -right-px rounded-tl bg-background px-px text-[8px] font-semibold leading-none text-foreground-passive">
                {count}
              </span>
            )}
          </span>
        );
      })}
    </div>
  );
}
