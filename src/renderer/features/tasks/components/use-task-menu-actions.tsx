import { useTranslation } from 'react-i18next';
import { buildTaskDeepLink } from '@shared/deep-links';
import { INTERNAL_PROJECT_ID } from '@shared/projects';
import { getProjectStore } from '@renderer/features/projects/stores/project-selectors';
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
import { rpc } from '@renderer/lib/ipc';
import { useNavigate } from '@renderer/lib/layout/navigation-provider';
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
  const showRename = useShowModal('renameTaskModal');
  const showArchiveWithNote = useShowModal('archiveTaskWithNoteModal');
  const showCreateSubtask = useShowModal('newSubtaskModal');
  const showSetParent = useShowModal('setParentTaskModal');
  const { archiveTask, hasPreArchiveCommand } = useArchiveTask(projectId);

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
    // Direct archive: dialog for an optional note, no pre-archive skill.
    onArchive: () => showArchiveWithNote({ projectId, taskId, taskName, skipPreCommand: true }),
    // Run the configured pre-archive skill against every live session, then archive.
    onArchiveWithSkill: () => {
      if (isArchiving) return;
      void archiveTask(taskId).catch((error: unknown) => {
        log.warn('useTaskMenuActions: archive task failed', { projectId, taskId, error });
      });
    },
    hasArchiveSkill: hasPreArchiveCommand,
    onConfigureArchiveSkill: () => navigate('settings', { tab: 'sessions' }),
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
    // Show this task in an extra pane beside whatever is currently routed.
    onOpenBeside:
      !isArchived && task.state !== 'unregistered'
        ? () => splitViewStore.add({ projectId, taskId })
        : undefined,
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
