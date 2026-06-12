import type { Task } from '@shared/tasks';
import { isUnmountedProject } from '@renderer/features/projects/stores/project';
import { getProjectManagerStore } from '@renderer/features/projects/stores/project-selectors';
import type { AgentStatus } from '@renderer/features/tasks/conversations/conversation-manager';
import type { DiffViewStore } from '@renderer/features/tasks/diff-view/stores/diff-view-store';
import type { FileModelLifecycleStore } from '@renderer/features/tasks/editor/stores/file-model-lifecycle-store';
import { appState } from '@renderer/lib/stores/app-state';
import {
  isUnprovisioned,
  isUnregistered,
  registeredTaskData,
  type ProvisionedTask,
  type TaskStore,
} from './task';
import type { TaskManagerStore } from './task-manager';
import type { TaskViewStore } from './task-view';

/** Call only inside `observer` components (or other MobX reactions). */
export function getTaskManagerStore(projectId: string): TaskManagerStore | undefined {
  const p = getProjectManagerStore().projects.get(projectId);
  return p?.mountedProject?.taskManager;
}

/** Call only inside `observer` components (or other MobX reactions). */
export function getTaskStore(projectId: string, taskId: string): TaskStore | undefined {
  return getTaskManagerStore(projectId)?.tasks.get(taskId);
}

/** Registered task payload (`Task`) when the row exists and is not unregistered; otherwise undefined. */
export function getRegisteredTaskData(projectId: string, taskId: string): Task | undefined {
  const store = getTaskStore(projectId, taskId);
  if (!store) return undefined;
  return registeredTaskData(store);
}

/** Call only inside `observer` components (or other MobX reactions). */
export function getTaskView(projectId: string, taskId: string): TaskViewStore | undefined {
  return asProvisioned(getTaskStore(projectId, taskId))?.taskView;
}

/** Call only inside `observer` components (or other MobX reactions). */
export function getEditorView(
  projectId: string,
  taskId: string
): FileModelLifecycleStore | undefined {
  return getTaskView(projectId, taskId)?.editorView;
}

/** Call only inside `observer` components (or other MobX reactions). */
export function getDiffView(projectId: string, taskId: string): DiffViewStore | undefined {
  return getTaskView(projectId, taskId)?.diffView;
}

export function getTaskGitStore(projectId: string, taskId: string) {
  return asProvisioned(getTaskStore(projectId, taskId))?.workspace.git;
}

/** Direct children of a task in the subtask tree. Call only inside MobX reactions. */
export function taskChildren(projectId: string, taskId: string): TaskStore[] {
  const manager = getTaskManagerStore(projectId);
  if (!manager) return [];
  const children: TaskStore[] = [];
  for (const store of manager.tasks.values()) {
    const data = registeredTaskData(store);
    if (data?.parentTaskId === taskId) children.push(store);
  }
  return children;
}

/**
 * Ancestor chain of a task, nearest parent first. Bounded by the number of
 * known tasks so dirty-data cycles can't hang the renderer.
 */
export function taskAncestors(projectId: string, taskId: string): TaskStore[] {
  const manager = getTaskManagerStore(projectId);
  if (!manager) return [];
  const ancestors: TaskStore[] = [];
  const start = manager.tasks.get(taskId);
  let currentId = start ? registeredTaskData(start)?.parentTaskId : undefined;
  for (let steps = 0; steps <= manager.tasks.size && currentId; steps++) {
    const parent = manager.tasks.get(currentId);
    if (!parent) break;
    ancestors.push(parent);
    currentId = registeredTaskData(parent)?.parentTaskId;
  }
  return ancestors;
}

/** Whether `candidateId` is inside the subtree rooted at `ancestorId`. */
export function isTaskDescendantOf(
  projectId: string,
  candidateId: string,
  ancestorId: string
): boolean {
  return taskAncestors(projectId, candidateId).some((store) => {
    const data = registeredTaskData(store);
    return data?.id === ancestorId;
  });
}

export function taskAgentStatus(store: TaskStore): AgentStatus | null {
  const task = registeredTaskData(store);
  if (task) {
    const runtimeStatus = appState.agentRuntime.taskStatus(task.projectId, task.id);
    if (runtimeStatus === 'working' || runtimeStatus === 'awaiting-input') {
      return runtimeStatus;
    }
    if (
      (runtimeStatus === 'error' || runtimeStatus === 'completed') &&
      appState.agentRuntime.isTaskUnread(task.projectId, task.id)
    ) {
      return runtimeStatus;
    }
  }
  return asProvisioned(store)?.conversations.taskStatus ?? null;
}

/**
 * Task-level notification signal: only statuses that need the user
 * (awaiting-input, or unread error/completed). `working` is a session-level
 * concern — the session tabs spin on their own — so it never surfaces here.
 */
export function taskNotificationStatus(store: TaskStore): AgentStatus | null {
  const status = taskAgentStatus(store);
  return status === 'working' || status === 'idle' ? null : status;
}

/**
 * The next session that needs consuming: awaiting-input first, then unread
 * error/completed, in conversation order. Cycles past `afterConversationId`
 * (the one currently in view) so repeated clicks walk the pending list.
 */
export function nextAttentionConversationId(
  store: TaskStore,
  afterConversationId?: string
): string | undefined {
  const provisioned = asProvisioned(store);
  let candidates: string[];
  if (provisioned) {
    const awaiting: string[] = [];
    const finished: string[] = [];
    for (const conversation of provisioned.conversations.conversations.values()) {
      const status = conversation.indicatorStatus;
      if (status === 'awaiting-input') awaiting.push(conversation.data.id);
      else if (status === 'error' || status === 'completed') finished.push(conversation.data.id);
    }
    candidates = [...awaiting, ...finished];
  } else {
    const task = registeredTaskData(store);
    candidates = task
      ? appState.agentRuntime.attentionConversationIds(task.projectId, task.id)
      : [];
  }
  if (candidates.length === 0) return undefined;
  const index = afterConversationId ? candidates.indexOf(afterConversationId) : -1;
  return candidates[(index + 1) % candidates.length];
}

export type TaskViewKind =
  | 'missing'
  | 'project-mounting' // project is still opening — task data not yet available
  | 'project-error' // project failed to open
  | 'creating'
  | 'create-error'
  | 'naming'
  | 'naming-error'
  | 'provisioning'
  | 'provision-error'
  | 'teardown'
  | 'teardown-error'
  | 'idle'
  | 'ready';

/**
 * Derives the task view kind from the project + task store state.
 *
 * Pass `projectId` so that "project still opening" can be distinguished from
 * "task genuinely missing". Call only inside `observer` components.
 */
export function taskViewKind(store: TaskStore | undefined, projectId: string): TaskViewKind {
  const projectStore = getProjectManagerStore().projects.get(projectId);

  // Project doesn't exist at all
  if (!projectStore) return 'missing';

  // Project is being opened — tasks won't be available yet
  if (isUnmountedProject(projectStore)) {
    if (projectStore.phase === 'opening') return 'project-mounting';
    if (projectStore.phase === 'error') return 'project-error';
    // idle/closing unmounted — still needs to be opened
    return 'project-mounting';
  }

  // Project is still being created (unregistered)
  if (projectStore.state === 'unregistered') return 'missing';

  // Project is mounted — dispatch on task state
  if (!store) return 'missing';

  if (isUnregistered(store)) {
    if (store.phase === 'creating') return 'creating';
    return 'create-error';
  }
  if (isUnprovisioned(store)) {
    if (store.phase === 'naming') return 'naming';
    if (store.phase === 'naming-error') return 'naming-error';
    if (store.phase === 'provision') return 'provisioning';
    if (store.phase === 'provision-error') return 'provision-error';
    if (store.phase === 'teardown') return 'teardown';
    if (store.phase === 'teardown-error') return 'teardown-error';
    return 'idle';
  }
  return 'ready';
}

/** Returns the provisioned task payload if ready, otherwise undefined. */
export function asProvisioned(store: TaskStore | undefined): ProvisionedTask | undefined {
  return store?.provisionedTask ?? undefined;
}

/** Returns the display name from any task store variant. */
export function taskDisplayName(store: TaskStore | undefined): string | undefined {
  if (!store) return undefined;
  return store.data.name;
}

/** Returns the error message for error states. */
export function taskErrorMessage(store: TaskStore | undefined): string | undefined {
  if (!store) return undefined;
  if (isUnregistered(store) && store.phase === 'create-error') {
    return store.errorMessage ?? 'Failed to create task';
  }
  if (isUnprovisioned(store)) {
    if (store.phase === 'naming-error') {
      return store.errorMessage ?? store.data.setupError ?? 'Failed to generate task names';
    }
    if (store.phase === 'provision-error') {
      return store.errorMessage ?? 'Failed to set up workspace';
    }
    if (store.phase === 'teardown-error') {
      return store.errorMessage ?? 'Failed to tear down task';
    }
  }
  return undefined;
}

/** Returns the mount error message for the project. */
export function projectMountErrorMessage(projectId: string): string {
  const store = getProjectManagerStore().projects.get(projectId);
  if (store && isUnmountedProject(store) && store.phase === 'error') {
    return store.error ?? 'Failed to open project';
  }
  return 'Failed to open project';
}
