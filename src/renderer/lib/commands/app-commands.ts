import { INTERNAL_PROJECT_ID } from '@shared/projects';
import { openNewTaskFromCurrentContext } from '@renderer/app/open-new-task';
import { applyHistoryEntry } from '@renderer/lib/components/nav-buttons';
import { showModal } from '@renderer/lib/modal/modal-provider';
import { appState } from '@renderer/lib/stores/app-state';
import { commandRegistry } from './registry';
import type { AppCommand, CommandProvider } from './types';

function createAppCommandProvider(): CommandProvider {
  return {
    scopeId: 'app',

    getCommands(): AppCommand[] {
      // Reads MobX observables — reactions automatically invalidate activeCommands
      // when navigation changes.
      const viewId = appState.navigation.currentViewId;
      const params = appState.navigation.viewParamsStore[viewId] as
        | { projectId?: string; taskId?: string }
        | undefined;
      const projectId = params?.projectId;
      const taskId =
        viewId === 'task' && projectId !== INTERNAL_PROJECT_ID ? params?.taskId : undefined;

      const commands: AppCommand[] = [
        {
          id: 'app.settings',
          label: 'Open Settings',
          description: 'Open application settings',
          shortcutKey: 'settings',
          group: 'App',
          execute() {
            appState.navigation.navigate('settings');
          },
        },
        {
          id: 'app.newProject',
          label: 'New Project',
          description: 'Add a new local or SSH project',
          shortcutKey: 'newProject',
          group: 'App',
          execute() {
            showModal('addProjectModal', { strategy: 'local', mode: 'pick' });
          },
        },
      ];

      commands.push({
        id: 'app.newTask',
        label: taskId ? 'New Subtask and Start Session' : 'New Task',
        description: taskId
          ? 'Create a child task with an Agent session'
          : projectId
            ? 'Create a new task in this project'
            : 'Create a new task',
        shortcutKey: 'newTask',
        group: 'App',
        execute() {
          void openNewTaskFromCurrentContext(projectId, taskId);
        },
      });

      commands.push(
        {
          id: 'app.navigateBack',
          label: 'Go Back',
          description: 'Navigate to the previous location',
          shortcutKey: 'navigateBack',
          group: 'Navigation',
          enabled: appState.history.canGoBack,
          execute() {
            appState.history.back(applyHistoryEntry);
          },
        },
        {
          id: 'app.navigateForward',
          label: 'Go Forward',
          description: 'Navigate to the next location',
          shortcutKey: 'navigateForward',
          group: 'Navigation',
          enabled: appState.history.canGoForward,
          execute() {
            appState.history.forward(applyHistoryEntry);
          },
        }
      );

      return commands;
    },
  };
}

/**
 * Registers the app-scope CommandProvider. Must be called once at startup.
 * The provider is permanent — it reacts to navigation changes via MobX
 * observables inside getCommands().
 */
export function setupAppCommandProvider(): void {
  commandRegistry.register(createAppCommandProvider());
}
