import { makeAutoObservable, toJS } from 'mobx';
import type { NavigationSnapshot } from '@shared/view-state';
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
> = {
  home: 'home_viewed',
  project: 'project_viewed',
  task: 'task_viewed',
  file: 'file_viewed',
  settings: 'settings_viewed',
  skills: 'skills_viewed',
  skill: 'skills_viewed',
  mcp: 'mcp_viewed',
  agentManager: 'agents_viewed',
  agents: 'agents_viewed',
  maas: 'maas_viewed',
  automation: 'automation_viewed',
  mobile: 'mobile_viewed',
  usage: 'usage_viewed',
  roadmap: 'roadmap_viewed',
};

export class NavigationStore implements Snapshottable<NavigationSnapshot> {
  currentViewId: ViewId = 'home';
  viewParamsStore: ViewParamsStore = {};
  isNavigating: boolean = false;

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
    if (snapshot.currentViewId) this.currentViewId = snapshot.currentViewId as ViewId;
    if (snapshot.viewParams) this.viewParamsStore = snapshot.viewParams as ViewParamsStore;
  }
}
