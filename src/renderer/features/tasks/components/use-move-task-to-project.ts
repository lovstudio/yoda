import type { TFunction } from 'i18next';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { MoveTaskToProjectError } from '@shared/tasks';
import {
  asProvisioned,
  getTaskManagerStore,
  getTaskStore,
} from '@renderer/features/tasks/stores/task-selectors';
import { toast } from '@renderer/lib/hooks/use-toast';
import {
  useNavigate,
  useParams,
  useWorkspaceSlots,
} from '@renderer/lib/layout/navigation-provider';
import { useShowModal } from '@renderer/lib/modal/modal-provider';

/** Re-home a task under another project. */
export type MoveTaskToProject = (
  projectId: string,
  taskId: string,
  targetProjectId: string
) => void;

/**
 * Shared "move task to project" behavior for every surface (context menu,
 * dropdown menu, sidebar drag) — see agents/conventions/reuse.md. Confirms when
 * the move would leave history or migrate a worktree, runs the move, surfaces
 * errors, and follows the task to its new home if the active route points at it.
 */
export function useMoveTaskToProject(): MoveTaskToProject {
  const { t } = useTranslation();
  const { navigate } = useNavigate();
  const { currentView } = useWorkspaceSlots();
  const { params: routeTaskParams } = useParams('task');
  const showConfirmMove = useShowModal('confirmActionModal');

  return useCallback(
    (projectId, taskId, targetProjectId) => {
      if (!targetProjectId || targetProjectId === projectId) return;
      const taskManager = getTaskManagerStore(projectId);
      const task = getTaskStore(projectId, taskId);
      if (!taskManager || !task) return;

      const branchName =
        asProvisioned(task)?.workspace?.git.branchName ??
        ('taskBranch' in task.data ? task.data.taskBranch : undefined);
      const hasStoredConversations = Object.values(task.conversationStats).some(
        (count) => count > 0
      );

      const followsActiveRoute =
        currentView === 'task' &&
        routeTaskParams.projectId === projectId &&
        routeTaskParams.taskId === taskId;

      const runMove = async (): Promise<void> => {
        const error = await taskManager.moveTaskToProject(taskId, targetProjectId);
        if (error) {
          toast({ title: formatMoveError(error, t), variant: 'destructive' });
          return;
        }
        // The route still points at the old project — follow the task home.
        if (followsActiveRoute) navigate('task', { projectId: targetProjectId, taskId });
      };

      // Worktree tasks migrate their branch (uncommitted work gets committed);
      // tasks with stored sessions leave their transcript behind — warn first.
      const warning = branchName
        ? t('tasks.moveToProject.confirmWorktreeWarning')
        : hasStoredConversations
          ? t('tasks.moveToProject.confirmHistoryWarning')
          : undefined;
      if (warning) {
        showConfirmMove({
          title: t('tasks.moveToProject.confirmTitle'),
          description: warning,
          confirmLabel: t('tasks.moveToProject.confirmLabel'),
          variant: 'default',
          onSuccess: () => void runMove(),
        });
        return;
      }
      void runMove();
    },
    [t, navigate, currentView, routeTaskParams.projectId, routeTaskParams.taskId, showConfirmMove]
  );
}

function formatMoveError(error: MoveTaskToProjectError, t: TFunction): string {
  switch (error.type) {
    case 'has-subtasks':
      return t('tasks.moveToProject.errorHasSubtasks');
    case 'unsupported-transport':
      return t('tasks.moveToProject.errorUnsupportedTransport');
    case 'source-project-not-open':
      return t('tasks.moveToProject.errorSourceNotOpen');
    case 'git-error':
      return t('tasks.moveToProject.errorGit', { detail: error.detail });
    case 'project-not-found':
    case 'task-not-found':
    case 'same-project':
      return t('tasks.moveToProject.errorGeneric');
  }
}
