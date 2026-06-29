import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { buildTaskDeepLink } from '@shared/deep-links';
import { INTERNAL_PROJECT_ID } from '@shared/projects';
import type { MoveTaskToProjectError } from '@shared/tasks';
import {
  getProjectStore,
  getRepositoryStore,
} from '@renderer/features/projects/stores/project-selectors';
import { useArchiveTask } from '@renderer/features/tasks/archive-task';
import { splitViewStore } from '@renderer/features/tasks/split-view/split-view-store';
import { registeredTaskData } from '@renderer/features/tasks/stores/task';
import {
  asProvisioned,
  getTaskManagerStore,
  getTaskStore,
  taskChildren,
} from '@renderer/features/tasks/stores/task-selectors';
import { OVERVIEW_TAB_ID } from '@renderer/features/tasks/tabs/tab-manager-store';
import { toast } from '@renderer/lib/hooks/use-toast';
import { rpc } from '@renderer/lib/ipc';
import {
  useNavigate,
  useParams,
  useWorkspaceSlots,
} from '@renderer/lib/layout/navigation-provider';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { log } from '@renderer/utils/logger';
import { copyTaskLink, type TaskMenuActions } from './task-context-menu';
import {
  buildTaskMenuSessionFields,
  getTaskMenuConversation,
  resolveTaskMenuSessionFields,
  selectPreferredConversation,
} from './task-menu-session-info';

/**
 * Shared wiring for the task entity's menu. Every surface that shows a task
 * (sidebar row, kanban/list row, top-level tab) derives its context/actions
 * menu from here so the entity behaves identically everywhere — see
 * agents/conventions/reuse.md. Returns null when the task store is missing.
 */
export function useTaskMenuActions(projectId: string, taskId: string): TaskMenuActions | null {
  const { t } = useTranslation();
  const { navigate } = useNavigate();
  const { currentView } = useWorkspaceSlots();
  const { params: routeTaskParams } = useParams('task');
  const showRename = useShowModal('renameTaskModal');
  const showArchiveWithNote = useShowModal('archiveTaskWithNoteModal');
  const showCreateSubtask = useShowModal('newSubtaskModal');
  const showSetParent = useShowModal('setParentTaskModal');
  const showCreateParent = useShowModal('createParentTaskModal');
  const showConfirmMove = useShowModal('confirmActionModal');
  const { archiveTask } = useArchiveTask(projectId);

  const task = getTaskStore(projectId, taskId);
  const taskManager = getTaskManagerStore(projectId);
  if (!task) return null;

  const taskName = task.data.name;
  const isArchived = Boolean(registeredTaskData(task)?.archivedAt);
  // Direct children = compare-group candidates (or generic subtasks).
  const childTaskIds =
    projectId !== INTERNAL_PROJECT_ID
      ? taskChildren(projectId, taskId)
          .map((child) => registeredTaskData(child)?.id)
          .filter((id): id is string => Boolean(id))
      : [];
  const isArchiving = taskManager?.archivingTaskIds.has(taskId) ?? false;
  const canAssignWorkspace = projectId === INTERNAL_PROJECT_ID || task.data.isPinned;

  const project = getProjectStore(projectId);
  const projectName =
    project?.state === 'unregistered' ? projectId : (project?.displayName ?? projectId);
  const projectPath = project?.data?.path;
  const repoDefaultBranch = getRepositoryStore(projectId)?.defaultBranch;

  const provisionedTask = asProvisioned(task);
  const workspace = provisionedTask?.workspace;
  const branchName =
    workspace?.git.branchName ?? ('taskBranch' in task.data ? task.data.taskBranch : undefined);

  const sessionInfoCwd = provisionedTask?.path ?? projectPath;
  const menuConversation = getTaskMenuConversation(provisionedTask);
  const sessionFields = menuConversation
    ? buildTaskMenuSessionFields(menuConversation, sessionInfoCwd)
    : {};
  const hasStoredConversations = Object.values(task.conversationStats).some((count) => count > 0);
  const resolveSessionInfo = menuConversation
    ? () => resolveTaskMenuSessionFields(menuConversation, sessionInfoCwd)
    : hasStoredConversations && task.state !== 'unregistered'
      ? async () => {
          const conversations = await rpc.conversations.getConversationsForTask(projectId, taskId);
          const conversation = selectPreferredConversation(conversations);
          return conversation
            ? resolveTaskMenuSessionFields(conversation, sessionInfoCwd)
            : undefined;
        }
      : undefined;

  // "Move to project" re-homes a task under another project. Leaf tasks only —
  // a subtree would straddle two projects. Worktree tasks are eligible too: the
  // main process migrates their branch into the destination repo. The main
  // process re-validates all of this authoritatively.
  const canMoveToProject =
    !isArchived && task.state !== 'unregistered' && childTaskIds.length === 0;

  const handleMoveToProject = (targetProjectId: string): void => {
    const followsActiveRoute =
      currentView === 'task' &&
      routeTaskParams.projectId === projectId &&
      routeTaskParams.taskId === taskId;
    const runMove = async (): Promise<void> => {
      const error = await taskManager?.moveTaskToProject(taskId, targetProjectId);
      if (error) {
        toast({ title: formatMoveError(error, t), variant: 'destructive' });
        return;
      }
      // The route still points at the old project — follow the task to its new home.
      if (followsActiveRoute) navigate('task', { projectId: targetProjectId, taskId });
    };
    // Worktree tasks migrate their branch (uncommitted work gets committed) and
    // tasks with stored sessions leave their transcript behind — warn before
    // re-homing in either case.
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
  };

  // The menu "open details" entry enters the task and activates its fixed
  // Overview tab (task info / sessions / sub-tasks), distinguishing it from a
  // plain row click which only enters the task view on the last-active tab.
  const handleOpenOverview = () => {
    if (task.state === 'unprovisioned' && task.phase === 'idle') {
      void taskManager?.provisionTask(taskId);
    }
    navigate('task', { projectId, taskId });
    asProvisioned(task)?.taskView.tabManager.setActiveTab(OVERVIEW_TAB_ID);
  };

  return {
    projectId,
    projectName,
    taskId,
    taskName,
    isPinned: task.data.isPinned,
    canPin: task.state !== 'unregistered',
    isArchived,
    needsReview: task.data.needsReview,
    canMarkReview: task.state !== 'unregistered',
    branchName,
    ...sessionFields,
    resolveSessionInfo,
    projectPath,
    workingDirectory: provisionedTask?.path,
    openDetailsLabel: t('tasks.context.openDetails'),
    onOpenDetails: isArchived ? undefined : handleOpenOverview,
    onPin: () => void task.setPinned(true),
    onUnpin: () => void task.setPinned(false),
    onMarkNeedsReview: () => void task.setNeedsReview(true),
    onUnmarkNeedsReview: () => void task.setNeedsReview(false),
    onRename: () => showRename({ projectId, taskId, currentName: taskName }),
    // Quick archive (sidebar icon): straight to archive, no skill, no dialog.
    onArchiveQuick: () => {
      if (isArchiving) return;
      void archiveTask(taskId, { skipPreCommand: true }).catch((error: unknown) => {
        log.warn('useTaskMenuActions: quick archive failed', { projectId, taskId, error });
      });
    },
    // Direct archive: dialog for an optional note, no pre-archive skill.
    onArchive: () => showArchiveWithNote({ projectId, taskId, taskName }),
    // Open the archive dialog in skill mode: an editable command prefilled from
    // the configured preset runs against every live session before archiving.
    onArchiveWithSkill: () => showArchiveWithNote({ projectId, taskId, taskName, withSkill: true }),
    onCopyYodaLink: () => void copyTaskLink(buildTaskDeepLink({ projectId, taskId }), t),
    onRestore: () => void taskManager?.restoreTask(taskId),
    onReconnect: workspace?.connectionState != null ? () => workspace.reconnect() : undefined,
    onRestartSession:
      provisionedTask && menuConversation
        ? (tmuxOverride?: boolean) =>
            void provisionedTask.conversations.restartConversation(
              menuConversation.id,
              undefined,
              tmuxOverride
            )
        : undefined,
    // Projectless Drafts tasks belong directly to a workspace, and pinned tasks
    // appear standalone in the workspace-scoped pinned strip — both can be moved
    // individually. Other project-bound tasks follow their project's workspace.
    currentWorkspaceId: canAssignWorkspace
      ? (registeredTaskData(task)?.sidebarWorkspaceId ?? project?.data?.workspaceId ?? null)
      : undefined,
    onAssignWorkspace: canAssignWorkspace
      ? (workspaceId: string | null) => void task.setSidebarWorkspaceId(workspaceId)
      : undefined,
    // Subtask tree entries — projectless Drafts tasks stay flat for now.
    onCreateSubtask:
      projectId !== INTERNAL_PROJECT_ID && task.state !== 'unregistered'
        ? () => showCreateSubtask({ projectId, parentTaskId: taskId })
        : undefined,
    onSetParent:
      projectId !== INTERNAL_PROJECT_ID && task.state !== 'unregistered'
        ? () => showSetParent({ projectId, taskId })
        : undefined,
    onCreateParent:
      projectId !== INTERNAL_PROJECT_ID &&
      task.state !== 'unregistered' &&
      Boolean(repoDefaultBranch)
        ? () => showCreateParent({ projectId, taskId, defaultName: taskName })
        : undefined,
    // Show this task in an extra pane beside whatever is currently routed.
    onOpenBeside:
      !isArchived && task.state !== 'unregistered'
        ? () => splitViewStore.add({ projectId, taskId })
        : undefined,
    onMoveToProject: canMoveToProject ? handleMoveToProject : undefined,
    // Compare-group parent: route to it as primary and tile all its children
    // (the alternative candidates) side by side.
    onTileCandidates:
      !isArchived && task.state !== 'unregistered' && childTaskIds.length > 0
        ? () => {
            navigate('task', { projectId, taskId });
            splitViewStore.replace(childTaskIds.map((id) => ({ projectId, taskId: id })));
          }
        : undefined,
  };
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
