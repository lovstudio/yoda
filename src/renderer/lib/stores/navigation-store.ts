import { makeAutoObservable, toJS } from 'mobx';
import type { NavigationSnapshot } from '@shared/view-state';
import { migratePersistedViewRoute } from '@renderer/app/route-migrations';
import { type ViewId, type WrapParams } from '@renderer/app/view-registry';
import { modalStore } from '@renderer/lib/modal/modal-store';
import type { HistoryEntry } from '@renderer/lib/stores/navigation-history-store';
import { focusTracker } from '@renderer/utils/focus-tracker';
import { captureTelemetry } from '@renderer/utils/telemetryClient';
// Resolved at call-site (not at module init); circular with app-state is safe.
import { appState } from './app-state';
import type { Snapshottable } from './snapshottable';

type ViewParamsStore = Partial<{ [K in ViewId]: WrapParams<K> }>;

export const viewEvents: Record<
  ViewId,
  | 'home_viewed'
  | 'project_viewed'
  | 'task_viewed'
  | 'file_viewed'
  | 'settings_viewed'
  | 'skills_viewed'
  | 'mcp_viewed'
  | 'agents_viewed'
  | 'maas_viewed'
  | 'automation_viewed'
  | 'mobile_viewed'
  | 'usage_viewed'
  | 'roadmap_viewed'
  | 'kanban_viewed'
  | 'ai_lab_viewed'
  | 'marketplace_viewed'
  | 'library_viewed'
> = {
  home: 'home_viewed',
  project: 'project_viewed',
  task: 'task_viewed',
  file: 'file_viewed',
  settings: 'settings_viewed',
  skills: 'skills_viewed',
  skill: 'skills_viewed',
  skillCompare: 'skills_viewed',
  mcp: 'mcp_viewed',
  agentManager: 'agents_viewed',
  agents: 'agents_viewed',
  maas: 'maas_viewed',
  automation: 'automation_viewed',
  mobile: 'mobile_viewed',
  usage: 'usage_viewed',
  roadmap: 'roadmap_viewed',
  kanban: 'kanban_viewed',
  aiLab: 'ai_lab_viewed',
  marketplace: 'marketplace_viewed',
  library: 'library_viewed',
  projectsOverview: 'project_viewed',
};

export class NavigationStore implements Snapshottable<NavigationSnapshot> {
  currentViewId: ViewId = 'home';
  viewParamsStore: ViewParamsStore = {};
  isNavigating: boolean = false;
  /**
   * Runtime-only generation for navigation intent. Unlike comparing the
   * current route, this distinguishes A -> B -> A from an uninterrupted A.
   */
  revision = 0;

  constructor() {
    makeAutoObservable(this);
  }

  navigate<T extends ViewId>(viewId: T, params?: WrapParams<T>): void {
    appState.history.pushNavigation(
      this._historyEntry(this.currentViewId),
      this._historyEntry(viewId, params)
    );
    this._applyNavigation(viewId, params);
  }

  private _historyEntry<T extends ViewId>(viewId: T, params?: WrapParams<T>): HistoryEntry {
    const effectiveParams = params ?? this.viewParamsStore[viewId] ?? ({} as WrapParams<T>);
    return {
      kind: 'view',
      viewId,
      params: toJS(effectiveParams) as WrapParams<ViewId>,
    };
  }

  _applyNavigation<T extends ViewId>(viewId: T, params?: WrapParams<T>): void {
    this.revision += 1;
    if (viewId !== this.currentViewId) {
      const transition = focusTracker.transition(
        viewId === 'task'
          ? { view: viewId }
          : {
              view: viewId,
              mainPanel: null,
              focusedRegion: null,
            },
        'navigation'
      );
      captureTelemetry(viewEvents[viewId], {
        from_view: transition?.previous.view ?? null,
      });
      this.currentViewId = viewId;
      this.isNavigating = true;
    }
    if (params !== undefined) {
      this.viewParamsStore = { ...this.viewParamsStore, [viewId]: params };
    }
    if (viewId === 'task') {
      const taskParams = params as WrapParams<'task'> | undefined;
      if (taskParams?.projectId && taskParams.taskId) {
        appState.agentRuntime.markTaskSeen(taskParams.projectId, taskParams.taskId);
      }
    }
    modalStore.closeModal();
  }

  updateViewParams<TId extends ViewId>(
    viewId: TId,
    update: Partial<WrapParams<TId>> | ((prev: WrapParams<TId>) => WrapParams<TId>)
  ): void {
    this.revision += 1;
    const current = (this.viewParamsStore[viewId] ?? {}) as WrapParams<TId>;
    const next = typeof update === 'function' ? update(current) : { ...current, ...update };
    this.viewParamsStore = { ...this.viewParamsStore, [viewId]: next };
  }

  get snapshot(): NavigationSnapshot {
    return {
      currentViewId: this.currentViewId,
      viewParams: toJS(this.viewParamsStore) as Record<string, unknown>,
    };
  }

  restoreSnapshot(snapshot: Partial<NavigationSnapshot>): void {
    const restoresNavigationState =
      snapshot.currentViewId !== undefined || snapshot.viewParams !== undefined;
    const restoredCurrent = snapshot.currentViewId
      ? migratePersistedViewRoute({
          viewId: snapshot.currentViewId,
          params: asRouteParams(snapshot.viewParams?.[snapshot.currentViewId]),
        })
      : null;

    if (snapshot.viewParams) {
      const restoredParams = Object.fromEntries(
        Object.entries(snapshot.viewParams).map(([viewId, params]) => {
          const migrated = migratePersistedViewRoute({
            viewId,
            params: asRouteParams(params),
          });
          return [migrated.viewId, migrated.params];
        })
      );
      if (restoredCurrent) restoredParams[restoredCurrent.viewId] = restoredCurrent.params;
      this.viewParamsStore = restoredParams as ViewParamsStore;
    }

    if (restoredCurrent) this.currentViewId = restoredCurrent.viewId as ViewId;
    if (restoresNavigationState) this.revision += 1;
  }
}

function asRouteParams(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}
