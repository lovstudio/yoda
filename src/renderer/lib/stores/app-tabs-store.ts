import { action, computed, makeObservable, observable, reaction, toJS } from 'mobx';
import type { AppTabsSnapshot } from '@shared/view-state';
import type { ViewId, WrapParams } from '@renderer/app/view-registry';
import { log } from '@renderer/utils/logger';
import type { NavigationStore } from './navigation-store';
import type { Snapshottable } from './snapshottable';

/**
 * A top-level app tab: a navigation context scoped to a task, a project, or a
 * global view. Each tab stores a route (viewId + params); the active tab's
 * route lives in NavigationStore, so views render unchanged.
 */
export type AppTabEntry = {
  id: string;
  viewId: ViewId;
  params: Record<string, unknown>;
  /** Monotonic activation counter — drives "restore last active tab of a scope". */
  seq?: number;
};

let tabSeq = 0;
function createTabId(): string {
  return `tab-${Date.now().toString(36)}-${++tabSeq}`;
}

/**
 * Canonical identity of a route for tab deduplication. Task routes normalize a
 * missing `tab` target to overview so `{task}` and `{task, tab:overview}` are
 * the same tab.
 */
export function routeKey(viewId: ViewId | string, params: Record<string, unknown>): string {
  // Home is a singleton — its params (e.g. projectId preselect) are transient
  // and must not fork tab identity, otherwise navigate('home', {projectId})
  // spawns a second uncloseable home tab next to the existing one.
  if (viewId === 'home') return JSON.stringify(['home']);
  if (viewId === 'task') {
    const { projectId, taskId, tab } = params as {
      projectId?: string;
      taskId?: string;
      tab?: unknown;
    };
    return JSON.stringify(['task', projectId, taskId, tab ?? { kind: 'overview' }]);
  }
  if (viewId === 'project') {
    const { projectId, view } = params as { projectId?: string; view?: string };
    return JSON.stringify(['project', projectId, view ?? 'overview']);
  }
  return JSON.stringify([viewId, params]);
}

/**
 * The fixed page set of a project scope — every page is a permanent top-level
 * tab (mirrors the former in-panel ToggleGroup). Keep in sync with the
 * ProjectView union in features/projects/stores/project-view.ts.
 */
export const PROJECT_PAGE_VIEWS = ['overview', 'tasks', 'sessions', 'harness', 'settings'] as const;
export type ProjectPageView = (typeof PROJECT_PAGE_VIEWS)[number];

/**
 * Scope of a tab — the isolation unit of the strip (IDE model). The strip only
 * shows tabs of the active scope; switching task/project swaps the whole set
 * while other scopes' tabs stay alive in the store.
 *
 *   task tabs            → task:{projectId}:{taskId}
 *   project + file tabs  → project:{projectId}   (project-root files belong to the project)
 *   global views         → view:{viewId}
 */
export function tabScopeKey(viewId: ViewId | string, params: Record<string, unknown>): string {
  if (viewId === 'task') {
    const { projectId, taskId } = params as { projectId?: string; taskId?: string };
    if (projectId && taskId) return `task:${projectId}:${taskId}`;
  }
  if (viewId === 'project' || viewId === 'file') {
    const { projectId } = params as { projectId?: string };
    if (projectId) return `project:${projectId}`;
  }
  return `view:${viewId}`;
}

/**
 * Index tabs are the fixed tabs of their scope (task overview, the project's
 * page set, every global view). They sort first and cannot be closed from
 * the strip.
 */
export function isIndexTab(tab: AppTabEntry): boolean {
  if (tab.viewId === 'task') {
    const target = tab.params.tab as { kind?: string } | undefined;
    return !target || target.kind === 'overview';
  }
  return tab.viewId !== 'file';
}

/** Fixed display order for a scope's index tabs (project page set order). */
function indexOrder(tab: AppTabEntry): number {
  if (tab.viewId !== 'project') return 0;
  const view = (tab.params.view as string | undefined) ?? 'overview';
  const index = (PROJECT_PAGE_VIEWS as readonly string[]).indexOf(view);
  return index === -1 ? PROJECT_PAGE_VIEWS.length : index;
}

export class AppTabsStore implements Snapshottable<AppTabsSnapshot> {
  tabs: AppTabEntry[] = [];
  activeTabId: string | null = null;
  /**
   * Bumped on every openTab — lets the task view re-run its route replay even
   * when the route itself didn't change (clicking the same session again must
   * re-align internal state if a previous alignment was disrupted).
   */
  replayNonce = 0;

  private readonly navigation: NavigationStore;
  private readonly closeListeners = new Set<(tab: AppTabEntry) => void>();
  private disposer: (() => void) | null = null;
  private activationSeq = 0;

  constructor(navigation: NavigationStore) {
    this.navigation = navigation;
    makeObservable(this, {
      tabs: observable,
      activeTabId: observable,
      replayNonce: observable,
      visibleTabs: computed,
      start: action,
      openTab: action,
      activateTab: action,
      closeTab: action,
      restoreSnapshot: action,
    });
  }

  /**
   * Seeds the first tab from the current navigation state (call AFTER snapshot
   * restore) and starts the route-sync reaction:
   *
   * - Same-scope navigation rewrites the active tab's route (address bar).
   * - Cross-scope navigation (sidebar task/project clicks, deep links, …)
   *   leaves the current scope's tabs intact and finds-or-creates the tab in
   *   the destination scope — the strip swaps to that scope's set.
   */
  start(): void {
    if (this.tabs.length === 0) {
      const tab: AppTabEntry = {
        id: createTabId(),
        viewId: this.navigation.currentViewId,
        params: toJS(
          this.navigation.viewParamsStore[this.navigation.currentViewId] ?? {}
        ) as Record<string, unknown>,
      };
      this.tabs.push(tab);
      this.activeTabId = tab.id;
    }

    this.disposer = reaction(
      () => ({
        viewId: this.navigation.currentViewId,
        params: this.navigation.viewParamsStore[this.navigation.currentViewId],
      }),
      action(({ viewId, params }) => {
        const tab = this.activeTab;
        if (!tab) return;
        const nextParams = toJS(params ?? {}) as Record<string, unknown>;

        // Entering a task/project without an explicit target (sidebar click,
        // deep link to the entity itself) restores the scope's last active
        // tab instead of forcing the overview. Re-entering the already-active
        // scope keeps the current tab — a tab-less route is a scope-entry
        // command, never a tab identity.
        const isScopeEntry =
          (viewId === 'task' && nextParams.tab === undefined) ||
          (viewId === 'project' && nextParams.view === undefined);
        if (isScopeEntry) {
          const scope = tabScopeKey(viewId, nextParams);
          const remembered =
            scope === tabScopeKey(tab.viewId, tab.params) ? tab : this._lastActiveInScope(scope);
          if (remembered) {
            this._activate(remembered);
            this.navigation._applyNavigation(
              remembered.viewId,
              remembered.params as WrapParams<ViewId>
            );
            return;
          }
        }

        const key = routeKey(viewId, nextParams);

        // Already on this route — just refresh params.
        if (routeKey(tab.viewId, tab.params) === key) {
          tab.viewId = viewId;
          tab.params = nextParams;
          return;
        }

        // The route exists as another tab (any scope) — focus it. Never
        // rewrite the current tab into a duplicate of an existing one.
        const existing = this.tabs.find((entry) => routeKey(entry.viewId, entry.params) === key);
        if (existing) {
          existing.params = nextParams;
          this._activate(existing);
          return;
        }

        // Task routes are tab-granular: navigation to a new target always
        // means a new tab, never rewriting whichever tab happens to be active
        // (that's how duplicate Overview tabs were born).
        if (
          viewId !== 'task' &&
          tabScopeKey(viewId, nextParams) === tabScopeKey(tab.viewId, tab.params)
        ) {
          tab.viewId = viewId;
          tab.params = nextParams;
          return;
        }

        const next: AppTabEntry = { id: createTabId(), viewId, params: nextParams };
        this.tabs.splice(this._insertIndex(viewId, nextParams), 0, next);
        this._activate(next);
        this._ensureScopeIndexTab(next);
      })
    );
  }

  /** Marks a tab active and stamps its activation order (scope memory). */
  private _activate(tab: AppTabEntry): void {
    this.activeTabId = tab.id;
    tab.seq = ++this.activationSeq;
  }

  private _lastActiveInScope(scope: string): AppTabEntry | undefined {
    let best: AppTabEntry | undefined;
    for (const tab of this.tabs) {
      if (tabScopeKey(tab.viewId, tab.params) !== scope) continue;
      if (!best || (tab.seq ?? 0) > (best.seq ?? 0)) best = tab;
    }
    return best;
  }

  get activeTab(): AppTabEntry | undefined {
    return this.tabs.find((tab) => tab.id === this.activeTabId);
  }

  get activeScope(): string {
    const tab = this.activeTab;
    return tab ? tabScopeKey(tab.viewId, tab.params) : 'view:home';
  }

  /** The strip's contents: only tabs of the active scope, index tabs first. */
  get visibleTabs(): AppTabEntry[] {
    const scope = this.activeScope;
    const scoped = this.tabs.filter((tab) => tabScopeKey(tab.viewId, tab.params) === scope);
    const indexTabs = scoped.filter(isIndexTab).sort((a, b) => indexOrder(a) - indexOrder(b));
    return [...indexTabs, ...scoped.filter((tab) => !isIndexTab(tab))];
  }

  /**
   * Opens a tab for the route, or activates the existing one (routes are
   * deduplicated). New tabs insert after the last tab of their scope.
   */
  openTab<T extends ViewId>(viewId: T, params?: WrapParams<T>): void {
    const normalizedParams = toJS(params ?? {}) as Record<string, unknown>;
    const key = routeKey(viewId, normalizedParams);
    const existing = this.tabs.find((entry) => routeKey(entry.viewId, entry.params) === key);
    log.debug('[tab-sync] openTab', { viewId, params: normalizedParams, dedupe: !!existing });
    this.replayNonce += 1;
    if (existing) {
      // Refresh params (normalization may differ from the stored shape).
      existing.params = normalizedParams;
      this._activate(existing);
      this.navigation._applyNavigation(viewId, normalizedParams as WrapParams<T>);
      return;
    }

    const tab: AppTabEntry = { id: createTabId(), viewId, params: normalizedParams };
    this.tabs.splice(this._insertIndex(viewId, normalizedParams), 0, tab);
    this._activate(tab);
    this._ensureScopeIndexTab(tab);
    this.navigation._applyNavigation(tab.viewId, tab.params as WrapParams<T>);
  }

  /** Insert after the last same-scope tab, else after the active tab. */
  private _insertIndex(viewId: ViewId, params: Record<string, unknown>): number {
    const scope = tabScopeKey(viewId, params);
    for (let i = this.tabs.length - 1; i >= 0; i--) {
      if (tabScopeKey(this.tabs[i].viewId, this.tabs[i].params) === scope) return i + 1;
    }
    const activeIndex = this.tabs.findIndex((entry) => entry.id === this.activeTabId);
    return activeIndex + 1;
  }

  /**
   * Materializes a scope's fixed tabs when entering it:
   * - task scope: the overview index tab (entering via a session/file deep
   *   link creates it on the fly, without activating it)
   * - project scope: the full page set (overview/tasks/sessions/harness/
   *   settings) — every page is a permanent top-level tab
   */
  private _ensureScopeIndexTab(tab: AppTabEntry): void {
    const scope = tabScopeKey(tab.viewId, tab.params);

    if (tab.viewId === 'project' || tab.viewId === 'file') {
      const { projectId } = tab.params as { projectId?: string };
      if (!projectId) return;
      const presentViews = new Set(
        this.tabs
          .filter((entry) => entry.viewId === 'project' && entry.params.projectId === projectId)
          .map((entry) => (entry.params.view as string | undefined) ?? 'overview')
      );
      const missing = PROJECT_PAGE_VIEWS.filter((view) => !presentViews.has(view)).map(
        (view): AppTabEntry => ({
          id: createTabId(),
          viewId: 'project',
          params: { projectId, view },
        })
      );
      if (missing.length === 0) return;
      const firstScopeIndex = this.tabs.findIndex(
        (entry) => tabScopeKey(entry.viewId, entry.params) === scope
      );
      this.tabs.splice(Math.max(firstScopeIndex, 0), 0, ...missing);
      return;
    }

    if (tab.viewId !== 'task' || isIndexTab(tab)) return;
    const { projectId, taskId } = tab.params as { projectId?: string; taskId?: string };
    if (!projectId || !taskId) return;
    const hasIndex = this.tabs.some(
      (entry) => tabScopeKey(entry.viewId, entry.params) === scope && isIndexTab(entry)
    );
    if (hasIndex) return;
    const indexTab: AppTabEntry = {
      id: createTabId(),
      viewId: 'task',
      params: { projectId, taskId, tab: { kind: 'overview' } },
    };
    const firstScopeIndex = this.tabs.findIndex(
      (entry) => tabScopeKey(entry.viewId, entry.params) === scope
    );
    this.tabs.splice(Math.max(firstScopeIndex, 0), 0, indexTab);
  }

  /** Closes every tab matching the predicate (e.g. all tabs of an archived task). */
  closeTabsWhere(predicate: (tab: AppTabEntry) => boolean): void {
    for (const tab of this.tabs.filter(predicate)) {
      this.closeTab(tab.id);
    }
  }

  // ---------------------------------------------------------------------------
  // TabNavigationProvider — tab shortcuts, scoped to the visible set
  // ---------------------------------------------------------------------------

  setNextTabActive(): void {
    this._activateByOffset(1);
  }

  setPreviousTabActive(): void {
    this._activateByOffset(-1);
  }

  setTabActiveIndex(index: number): void {
    const tab = this.visibleTabs[index];
    if (tab) this.activateTab(tab.id);
  }

  closeActiveTab(): void {
    const tab = this.activeTab;
    if (tab && !isIndexTab(tab)) this.closeTab(tab.id);
  }

  private _activateByOffset(offset: number): void {
    const visible = this.visibleTabs;
    if (visible.length < 2) return;
    const index = visible.findIndex((entry) => entry.id === this.activeTabId);
    if (index === -1) return;
    const next = visible[(index + offset + visible.length) % visible.length];
    this.activateTab(next.id);
  }

  /** Switches tabs without pushing navigation history. */
  activateTab(tabId: string): void {
    if (tabId === this.activeTabId) return;
    const tab = this.tabs.find((entry) => entry.id === tabId);
    if (!tab) return;
    // Order matters: set activeTabId first so the route-sync reaction triggered
    // by _applyNavigation writes into the NEW tab (a no-op) instead of clobbering
    // the old one.
    this._activate(tab);
    this.navigation._applyNavigation(tab.viewId, tab.params as WrapParams<ViewId>);
  }

  closeTab(tabId: string): void {
    const index = this.tabs.findIndex((entry) => entry.id === tabId);
    if (index === -1) return;
    const closedScope = tabScopeKey(this.tabs[index].viewId, this.tabs[index].params);
    const [closed] = this.tabs.splice(index, 1);
    for (const listener of this.closeListeners) listener(closed);

    if (this.activeTabId !== closed.id) return;

    // Prefer staying in the same scope; fall back to any neighbour.
    const scopedNeighbour = this.tabs.filter(
      (entry) => tabScopeKey(entry.viewId, entry.params) === closedScope
    );
    const next =
      scopedNeighbour[Math.min(index, scopedNeighbour.length - 1)] ??
      this.tabs[index] ??
      this.tabs[index - 1];
    if (next) {
      this.activeTabId = next.id;
      this.navigation._applyNavigation(next.viewId, next.params as WrapParams<ViewId>);
      return;
    }

    // Last tab closed — the app always keeps one tab; reset to home.
    const home: AppTabEntry = { id: createTabId(), viewId: 'home', params: {} };
    this.tabs.push(home);
    this.activeTabId = home.id;
    this.navigation._applyNavigation('home', {} as WrapParams<'home'>);
  }

  /** Notifies when a tab is removed — used to dispose per-tab resources (e.g. file sessions). */
  onTabClose(listener: (tab: AppTabEntry) => void): () => void {
    this.closeListeners.add(listener);
    return () => this.closeListeners.delete(listener);
  }

  get snapshot(): AppTabsSnapshot {
    return {
      tabs: toJS(this.tabs),
      activeTabId: this.activeTabId,
    };
  }

  restoreSnapshot(snapshot: Partial<AppTabsSnapshot>): void {
    if (!Array.isArray(snapshot.tabs) || snapshot.tabs.length === 0) return;
    // viewId is cast without runtime validation — same contract as
    // NavigationStore.restoreSnapshot. Dedupe by route (keep first) so blobs
    // persisted by older builds with duplicate tabs heal on restore.
    const seenRoutes = new Set<string>();
    const restored = snapshot.tabs
      .filter(
        (tab): tab is AppTabEntry => typeof tab?.id === 'string' && typeof tab.viewId === 'string'
      )
      .map((tab) => ({ ...tab, params: tab.params ?? {} }))
      .filter((tab) => {
        const key = routeKey(tab.viewId, tab.params);
        if (seenRoutes.has(key)) return false;
        seenRoutes.add(key);
        return true;
      });
    if (restored.length === 0) return;
    this.tabs = restored;
    this.activationSeq = Math.max(0, ...restored.map((tab) => tab.seq ?? 0));
    this.activeTabId = restored.some((tab) => tab.id === snapshot.activeTabId)
      ? (snapshot.activeTabId ?? restored[0].id)
      : restored[0].id;
  }

  dispose(): void {
    this.disposer?.();
    this.disposer = null;
  }
}
