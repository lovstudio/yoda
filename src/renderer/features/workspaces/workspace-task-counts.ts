import { ALL_WORKSPACES_ID, DEFAULT_WORKSPACE_ID } from '@shared/workspaces';
import { isMountedProject } from '@renderer/features/projects/stores/project';
import { getProjectManagerStore } from '@renderer/features/projects/stores/project-selectors';
import { registeredTaskData } from '@renderer/features/tasks/stores/task';
import { agentRuntimeStore, workspaceStore } from '@renderer/lib/stores/app-state';

export type WorkspaceTaskCounts = {
  /**
   * Tasks needing attention: agent running/awaiting input, marked "稍后再读"
   * (needsReview), or with an unseen attention-worthy status. Each task counts
   * at most once.
   */
  attention: number;
  /** Active (non-archived) tasks in the workspace. */
  total: number;
};

/** Whether an assigned workspace id matches the given selection. */
function matches(assignedId: string | null, workspaceId: string): boolean {
  if (workspaceId === ALL_WORKSPACES_ID) return true;
  if (workspaceId === DEFAULT_WORKSPACE_ID) return assignedId === null;
  return assignedId === workspaceId;
}

/**
 * Per-workspace task counts for the workspace switcher. A task's effective
 * workspace is its own `sidebarWorkspaceId` when set, otherwise its project's
 * `workspaceId` — mirroring how the sidebar groups project tasks (by project
 * workspace) and projectless tasks (by task `sidebarWorkspaceId`).
 *
 * Uses the global {@link agentRuntimeStore} so the running/unread numbers are
 * accurate even for tasks the user never opened.
 *
 * Call only inside `observer` components (reads MobX state).
 */
export function workspaceTaskCounts(workspaceId: string): WorkspaceTaskCounts {
  let attention = 0;
  let total = 0;

  for (const project of getProjectManagerStore().projects.values()) {
    if (!isMountedProject(project)) continue;
    const projectWorkspaceId = project.data.workspaceId ?? null;
    for (const task of project.mountedProject.taskManager.tasks.values()) {
      const data = registeredTaskData(task);
      // Skip unregistered/archived tasks — they aren't real, active rows.
      if (!data || data.archivedAt) continue;
      const effectiveWorkspaceId = data.sidebarWorkspaceId ?? projectWorkspaceId;
      if (!matches(effectiveWorkspaceId, workspaceId)) continue;

      total += 1;
      // Running, "稍后再读" (persisted needsReview flag) or an unseen
      // attention-worthy status — union, so a task never counts twice.
      if (
        agentRuntimeStore.isTaskRunning(data.projectId, data.id) ||
        data.needsReview ||
        agentRuntimeStore.isTaskUnread(data.projectId, data.id)
      ) {
        attention += 1;
      }
    }
  }

  return { attention, total };
}

/** Counts for the currently active workspace. */
export function activeWorkspaceTaskCounts(): WorkspaceTaskCounts {
  return workspaceTaskCounts(workspaceStore.activeWorkspaceId);
}
