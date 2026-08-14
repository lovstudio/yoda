import { describe, expect, it, vi } from 'vitest';
import {
  APP_STATE_HMR_SCHEMA_VERSION,
  isReusableAppState,
  needsFullReloadForRetainedAppState,
} from './app-state-hmr';

function currentAppStateShape() {
  return {
    hmrSchemaVersion: APP_STATE_HMR_SCHEMA_VERSION,
    workspaces: {},
    sidebar: {
      taskPriorityMode: true,
      sidebarArchivedTaskLoadState: 'idle',
      loadMoreSidebarArchivedTasks: vi.fn(),
    },
  };
}

describe('app state HMR compatibility', () => {
  it('reuses a retained state that implements the current store contract', () => {
    expect(isReusableAppState(currentAppStateShape())).toBe(true);
  });

  it('reloads an older retained state instead of pairing new UI with an old store instance', () => {
    const retainedBeforeArchivePagination = {
      workspaces: {},
      sidebar: { taskPriorityMode: true },
    };

    expect(isReusableAppState(retainedBeforeArchivePagination)).toBe(false);
    expect(needsFullReloadForRetainedAppState(retainedBeforeArchivePagination, true)).toBe(true);
  });

  it('requires a complete archive pagination capability even at the current schema version', () => {
    const current = currentAppStateShape();
    const missingArchiveLoader = {
      ...current,
      sidebar: {
        taskPriorityMode: current.sidebar.taskPriorityMode,
        sidebarArchivedTaskLoadState: current.sidebar.sidebarArchivedTaskLoadState,
      },
    };

    expect(isReusableAppState(missingArchiveLoader)).toBe(false);
  });

  it('does not request a reload outside HMR or without retained state', () => {
    expect(needsFullReloadForRetainedAppState(currentAppStateShape(), false)).toBe(false);
    expect(needsFullReloadForRetainedAppState(undefined, true)).toBe(false);
  });
});
