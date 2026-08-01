import type { InterfaceSettings } from '@shared/app-settings';
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

export async function openNewTaskFromPreference(projectId?: string): Promise<void> {
  openNewTask(await resolveNewTaskOpenMode(), projectId);
}
