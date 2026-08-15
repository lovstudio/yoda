import type { InterfaceSettings } from '@shared/app-settings';
import { INTERNAL_PROJECT_ID } from '@shared/projects';
import { rpc } from '@renderer/lib/ipc';
import { showModal } from '@renderer/lib/modal/modal-provider';
import { queryClient } from '@renderer/lib/query-client';
import { appState } from '@renderer/lib/stores/app-state';

export type NewTaskOpenMode = InterfaceSettings['newTaskOpenMode'];

/**
 * The single product-level entry point for creating a task. Sidebar clicks and
 * the global shortcut both resolve the same persisted preference before opening
 * either the full Home surface or its composer-only modal.
 */
export function openNewTask(mode: NewTaskOpenMode, projectId?: string): void {
  if (mode === 'modal') {
    if (projectId) {
      appState.navigation.updateViewParams('home', { projectId });
    }
    showModal('newTaskModal', {});
    return;
  }

  appState.navigation.navigate('home', projectId ? { projectId } : undefined);
}

export async function resolveNewTaskOpenMode(): Promise<NewTaskOpenMode> {
  const cached = queryClient.getQueryData<{ value: InterfaceSettings }>([
    'appSettings',
    'interface',
    'meta',
  ]);
  return (
    cached?.value.newTaskOpenMode ??
    (await (rpc.appSettings.get('interface') as Promise<InterfaceSettings>)
      .then((settings) => settings.newTaskOpenMode)
      .catch(() => 'home' as const))
  );
}

export const NEW_TASK_OPEN_MODE_LABEL_KEYS: Record<NewTaskOpenMode, string> = {
  home: 'sidebar.newTaskOpenHome',
  modal: 'sidebar.newTaskOpenModal',
};

export function otherNewTaskOpenMode(mode: NewTaskOpenMode): NewTaskOpenMode {
  return mode === 'home' ? 'modal' : 'home';
}

/**
 * `invert` is the one-off escape hatch behind Alt/Option: open in the mode the
 * preference is not set to, without touching the persisted preference.
 */
export async function openNewTaskFromPreference(projectId?: string, invert = false): Promise<void> {
  const mode = await resolveNewTaskOpenMode();
  openNewTask(invert ? otherNewTaskOpenMode(mode) : mode, projectId);
}

/**
 * Creates from the user's current location. Inside a project task, the next
 * unit of work belongs to that task, so open the shared task composer with the
 * parent scope locked and an initial Agent session as the primary action.
 * Other surfaces retain the user's normal new-task opening preference.
 */
export async function openNewTaskFromCurrentContext(
  projectId?: string,
  parentTaskId?: string
): Promise<void> {
  if (projectId && parentTaskId && projectId !== INTERNAL_PROJECT_ID) {
    showModal('newTaskModal', {
      parentTask: {
        projectId,
        taskId: parentTaskId,
      },
    });
    return;
  }

  await openNewTaskFromPreference(projectId);
}
