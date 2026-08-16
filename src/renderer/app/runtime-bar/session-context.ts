import { getRuntime, isValidRuntimeId, type RuntimeId } from '@shared/runtime-registry';
import { asMounted, getProjectStore } from '@renderer/features/projects/stores/project-selectors';
import { asProvisioned, getTaskStore } from '@renderer/features/tasks/stores/task-selectors';
import { appState } from '@renderer/lib/stores/app-state';
import { agentConfig } from '@renderer/utils/agentConfig';

export function explicitConversationRuntimeId(value: unknown): RuntimeId | null {
  return typeof value === 'string' && isValidRuntimeId(value) ? value : null;
}

/**
 * What the bar's entries mean by "the current session": the route's project and
 * task, and — only when a conversation declares one — its runtime.
 *
 * Reads MobX observables, so callers must be `observer` components. Entries take
 * only the fields they use; the bar shell decides whether a session group exists
 * at all from `runtimeId`.
 */
export function useRuntimeBarSession() {
  const route = appState.navigation.currentViewId;
  const params = appState.navigation.viewParamsStore[route] as
    | { projectId?: string; taskId?: string }
    | undefined;
  const provisionedTask =
    route === 'task' && params?.projectId && params.taskId
      ? asProvisioned(getTaskStore(params.projectId, params.taskId))
      : undefined;
  const activeProjectId = params?.projectId;
  const activeMountedProject = activeProjectId
    ? asMounted(getProjectStore(activeProjectId))
    : undefined;
  const runtimeId = explicitConversationRuntimeId(
    provisionedTask?.taskView.tabManager.activeConversation?.data.runtimeId
  );

  return {
    route,
    activeProjectId,
    activeTaskId: params?.taskId,
    provisionedTask,
    activeMountedProjectData: activeMountedProject?.data ?? null,
    runtimeId,
    runtime: runtimeId ? getRuntime(runtimeId) : null,
    runtimeConfig: runtimeId ? agentConfig[runtimeId] : null,
    activeConversation: provisionedTask?.taskView.tabManager.activeConversation?.data ?? null,
    activeConversationId: provisionedTask?.taskView.tabManager.activeConversationId,
    connectionId: provisionedTask?.workspace.sshConnectionId,
  };
}

export type RuntimeBarSession = ReturnType<typeof useRuntimeBarSession>;
