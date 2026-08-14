import { appState } from '@renderer/lib/stores/app-state';

/**
 * Opens (or focuses) the app tab for a project file (or a project-less
 * absolute path when `projectId` is null). Kept separate from the file-session
 * lifecycle so lightweight terminal surfaces do not pull Monaco into tests.
 */
export function openProjectFileTab(projectId: string | null, filePath: string): void {
  const existing = appState.appTabs.tabs.find(
    (tab) =>
      tab.viewId === 'file' &&
      (tab.params.projectId ?? null) === projectId &&
      tab.params.filePath === filePath
  );
  if (existing) {
    appState.appTabs.activateTab(existing.id);
    return;
  }
  appState.appTabs.openTab('file', projectId ? { projectId, filePath } : { filePath });
}
