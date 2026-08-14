export const APP_STATE_HMR_SCHEMA_VERSION = 1;

type RetainedSidebarState = {
  taskPriorityMode?: unknown;
  sidebarArchivedTaskLoadState?: unknown;
  loadMoreSidebarArchivedTasks?: unknown;
};

export type RetainedAppState = {
  hmrSchemaVersion?: unknown;
  workspaces?: unknown;
  sidebar?: RetainedSidebarState;
};

/**
 * HMR keeps class instances alive, so newly added class fields and prototype
 * methods do not appear on an instance constructed by an older module version.
 * Keep this contract explicit: incompatible state needs a full renderer reload
 * so bootstrap can construct and hydrate every store again.
 */
export function isReusableAppState(value: RetainedAppState | undefined): boolean {
  const archiveLoadState = value?.sidebar?.sidebarArchivedTaskLoadState;
  return (
    value?.hmrSchemaVersion === APP_STATE_HMR_SCHEMA_VERSION &&
    value.workspaces !== undefined &&
    typeof value.sidebar?.taskPriorityMode === 'boolean' &&
    typeof value.sidebar.loadMoreSidebarArchivedTasks === 'function' &&
    (archiveLoadState === 'idle' || archiveLoadState === 'loading' || archiveLoadState === 'error')
  );
}

export function needsFullReloadForRetainedAppState(
  value: RetainedAppState | undefined,
  hmrEnabled: boolean
): boolean {
  return hmrEnabled && value !== undefined && !isReusableAppState(value);
}
