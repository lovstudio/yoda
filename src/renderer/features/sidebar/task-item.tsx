import { Archive, MoreHorizontal } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
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
} from '@renderer/features/tasks/stores/task-selectors';
import { rpc } from '@renderer/lib/ipc';
import {
  useNavigate,
  useParams,
  useWorkspaceSlots,
} from '@renderer/lib/layout/navigation-provider';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { cn } from '@renderer/utils/utils';
import { PrBadge } from '../../lib/components/pr-badge';
import { SidebarItemMiniButton, SidebarMenuRow } from './sidebar-primitives';

interface SidebarTaskItemProps {
  taskId: string;
  projectId: string;
  /** Pinned strip uses tighter padding than tasks nested under a project. */
  rowVariant?: 'underProject' | 'pinned';
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

  const isBootstrapping =
    task.state === 'unregistered' ||
    (task.state === 'unprovisioned' &&
      (task.phase === 'provision' || task.phase === 'provision-error'));

  const taskName = task.data.name;

  const handleProvision = () => {
    if (task.state !== 'unprovisioned' || task.phase !== 'idle') return;
    void taskManager?.provisionTask(taskId);
  };

  const handleArchive = () => {
    if (isActive) navigate('project', { projectId });
    void (async () => {
      await runPreArchiveCommand(projectId, taskId, preArchiveCommand);
      await taskManager?.archiveTask(taskId);
    })();
  };

  const handleArchiveWithNote = () => {
    showArchiveWithNote({
      projectId,
      taskId,
      taskName,
      onSuccess: () => {
        if (isActive) navigate('project', { projectId });
      },
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

  const menuActions = {
    isPinned: task.data.isPinned,
    canPin,
    isArchived: false,
    needsReview,
    canMarkReview,
    branchName,
    onPin: () => void task.setPinned(true),
    onUnpin: () => void task.setPinned(false),
    onMarkNeedsReview: () => void task.setNeedsReview(true),
    onUnmarkNeedsReview: () => void task.setNeedsReview(false),
    onRename: handleRename,
    onArchive: handleArchive,
    onArchiveWithNote: handleArchiveWithNote,
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
          rowVariant === 'pinned' ? 'pl-2' : 'pl-8'
        )}
        isActive={isActive}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          handleProvision();
          navigate('task', { projectId, taskId });
        }}
        onDoubleClick={(e) => {
          e.stopPropagation();
          handleRename();
        }}
      >
        <div className="flex min-w-0 flex-1 items-center gap-1 self-stretch overflow-hidden">
          <span
            className={cn(
              'min-w-0 truncate text-left transition-colors',
              isBootstrapping && 'text-foreground/40'
            )}
          >
            {taskName}
          </span>
          <RenderPrBadge task={task} />
        </div>
        <div
          className={cn(
            'items-center gap-0.5',
            isMenuOpen ? 'flex' : 'hidden group-hover/row:flex'
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
            aria-label={t('sidebar.archiveTask')}
            onClick={(e) => {
              e.stopPropagation();
              handleArchive();
            }}
          >
            <Archive className="h-4 w-4" />
          </SidebarItemMiniButton>
        </div>
        <div className={cn('items-center', isMenuOpen ? 'hidden' : 'flex group-hover/row:hidden')}>
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
