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
  if (viewId === 'file') return JSON.stringify(['file', params]);
  if (viewId === 'skill') {
    const { skillId } = params as { skillId?: string };
    // displayName is display-only — it must not fork tab identity.
    return JSON.stringify(['skill', skillId]);
  }
  // Global views (home, settings, skills, …) are singletons — their params
  // (e.g. home's projectId preselect, settings' inner tab) are transient
  // address-bar state and must not fork tab identity, otherwise
  // navigate('settings', {tab}) spawns a second uncloseable settings tab
  // next to the existing one.
  return JSON.stringify([viewId]);
}

/**
 * Stored tabs always carry an explicit target (`tab` for tasks, `view` for
 * projects). A target-less route is a scope-entry command (resolved to the
 * scope's last-active tab) — persisting it on the entry would turn every later
 * activation of that tab back into a scope entry. For task tabs that bounces
 * to the internal active tab instead of the overview; for project tabs it's
 * worse: the scope-entry restore re-applies the target-less params, which
 * re-triggers the route-sync reaction in a cycle until MobX aborts after 100
 * iterations and drops pending observer re-renders (the UI freezes on the
 * previous view with the previous scope's tabs).
 */
function normalizeTabParams(
  viewId: ViewId | string,
  params: Record<string, unknown>
): Record<string, unknown> {
  if (viewId === 'task' && params.tab === undefined) {
    return { ...params, tab: { kind: 'overview' } };
  }
  if (viewId === 'project' && params.view === undefined) {
    return { ...params, view: 'overview' };
  }
  return params;
}

/**
 * The fixed page set of a project scope — every page always shows as a
 * top-level tab (mirrors the former in-panel ToggleGroup); missing ones are
 * synthesized by `visibleTabs`, never persisted upfront. Keep in sync with
 * the ProjectView union in features/projects/stores/project-view.ts.
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
 *   skill detail tabs    → view:skills           (they sit next to the Skills index tab)
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
  if (viewId === 'skill') return 'view:skills';
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
  return tab.viewId !== 'file' && tab.viewId !== 'skill';
}

/**
 * Deterministic id for a fixed tab synthesized by `visibleTabs`. Stable across
 * recomputes (it derives from the route), so React keys and active-id
 * comparisons hold; if the tab gets activated it is stored under this same id.
 */
function syntheticTabId(viewId: ViewId, params: Record<string, unknown>): string {
  return `synth:${routeKey(viewId, params)}`;
}

export class AppTabsStore implements Snapshottable<AppTabsSnapshot> {
  tabs: AppTabEntry[] = [];
  activeTabId: string | null = null;
  /**
   * Bumped on every activating openTab — lets the task view re-run its route
   * replay even when the route itself didn't change (clicking the same session
   * again must re-align internal state if a previous alignment was disrupted).
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
        params: normalizeTabParams(
          this.navigation.currentViewId,
          toJS(this.navigation.viewParamsStore[this.navigation.currentViewId] ?? {}) as Record<
            string,
            unknown
          >
        ),
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
        const routedParams = toJS(params ?? {}) as Record<string, unknown>;

        // Entering a task/project without an explicit target (sidebar click,
        // deep link to the entity itself) restores the scope's last active
        // tab instead of forcing the overview. Re-entering the already-active
        // scope keeps the current tab — a tab-less route is a scope-entry
        // command, never a tab identity.
        const isScopeEntry =
          (viewId === 'task' && routedParams.tab === undefined) ||
          (viewId === 'project' && routedParams.view === undefined);
        if (isScopeEntry) {
          const scope = tabScopeKey(viewId, routedParams);
          const remembered =
            scope === tabScopeKey(tab.viewId, tab.params) ? tab : this._lastActiveInScope(scope);
          if (remembered) {
            // Heal target-less stored params (pre-normalization entries) —
            // re-applying them verbatim would re-enter this scope-entry branch
            // forever (see normalizeTabParams).
            remembered.params = normalizeTabParams(remembered.viewId, remembered.params);
            this._activate(remembered);
            this.navigation._applyNavigation(
              remembered.viewId,
              remembered.params as WrapParams<ViewId>
            );
            return;
          }
        }

        // Tabs store the explicit shape; a scope-entry route only falls
        // through to here on the first visit (no remembered tab to restore).
        const nextParams = normalizeTabParams(viewId, routedParams);
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

        // Task, project-page, and skill-detail routes are tab-granular:
        // navigation to a new target always means a new tab, never rewriting
        // whichever tab happens to be active (that's how duplicate Overview
        // tabs were born).
        if (
          viewId !== 'task' &&
          viewId !== 'project' &&
          viewId !== 'skill' &&
          tabScopeKey(viewId, nextParams) === tabScopeKey(tab.viewId, tab.params)
        ) {
          tab.viewId = viewId;
          tab.params = nextParams;
          return;
        }

        const next: AppTabEntry = { id: createTabId(), viewId, params: nextParams };
        this.tabs.splice(this._insertIndex(viewId, nextParams), 0, next);
        this._activate(next);
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

  /** The strip's contents: only tabs of the active scope, fixed tabs first. */
  get visibleTabs(): AppTabEntry[] {
    const active = this.activeTab;
    if (!active) return [];
    const scope = tabScopeKey(active.viewId, active.params);
    const scoped = this.tabs.filter((tab) => tabScopeKey(tab.viewId, tab.params) === scope);
    return [...this._fixedTabs(active, scoped), ...scoped.filter((tab) => !isIndexTab(tab))];
  }

  /**
   * The fixed tab set of the active scope, synthesized from the scope identity
   * rather than materialized into `tabs`. Stored entries (which carry id and
   * activation memory) take their slot; missing pages are filled with
   * deterministic synthetic entries — so the set always shows complete, no
   * matter how the scope was seeded or restored. Synthetic tabs are stored
   * only once activated (see `_activateVisible`).
   */
  private _fixedTabs(active: AppTabEntry, scoped: AppTabEntry[]): AppTabEntry[] {
    const stored = scoped.filter(isIndexTab);

    if (active.viewId === 'project' || active.viewId === 'file') {
      const { projectId } = active.params as { projectId?: string };
      if (!projectId) return stored;
      return PROJECT_PAGE_VIEWS.map((view) => {
        const entry = stored.find(
          (candidate) => ((candidate.params.view as string | undefined) ?? 'overview') === view
        );
        if (entry) return entry;
        const params = { projectId, view };
        return { id: syntheticTabId('project', params), viewId: 'project' as ViewId, params };
      });
    }

    if (active.viewId === 'task') {
      if (stored.length > 0) return stored;
      const { projectId, taskId } = active.params as { projectId?: string; taskId?: string };
      if (!projectId || !taskId) return stored;
      const params = { projectId, taskId, tab: { kind: 'overview' } };
      return [{ id: syntheticTabId('task', params), viewId: 'task' as ViewId, params }];
    }

    // Skill detail tabs share the skills scope — the Skills catalog is the
    // scope's index tab, synthesized when a detail tab was opened from
    // elsewhere (e.g. the settings hub) before the catalog tab existed.
    if (active.viewId === 'skill') {
      if (stored.length > 0) return stored;
      return [{ id: syntheticTabId('skills', {}), viewId: 'skills' as ViewId, params: {} }];
    }

    // Global view scopes: the single stored tab (the active one) is the set.
    return stored;
  }

  /**
   * Opens a tab for the route, or activates the existing one (routes are
   * deduplicated). New tabs insert after the last tab of their scope.
   * With `activate: false` the tab is only ensured in the strip — the active
   * tab and navigation stay untouched (e.g. unpinning a sidebar chip).
   */
  openTab<T extends ViewId>(
    viewId: T,
    params?: WrapParams<T>,
    options?: { activate?: boolean }
  ): void {
    const activate = options?.activate ?? true;
    const normalizedParams = normalizeTabParams(
      viewId,
      toJS(params ?? {}) as Record<string, unknown>
    );
    const key = routeKey(viewId, normalizedParams);
    const existing = this.tabs.find((entry) => routeKey(entry.viewId, entry.params) === key);
    log.debug('[tab-sync] openTab', { viewId, params: normalizedParams, dedupe: !!existing });
    if (activate) this.replayNonce += 1;
    if (existing) {
      // Refresh params (normalization may differ from the stored shape).
      existing.params = normalizedParams;
      if (!activate) return;
      this._activate(existing);
      this.navigation._applyNavigation(viewId, normalizedParams as WrapParams<T>);
      return;
    }

    const tab: AppTabEntry = { id: createTabId(), viewId, params: normalizedParams };
    this.tabs.splice(this._insertIndex(viewId, normalizedParams), 0, tab);
    if (activate) this._activate(tab);
    if (activate) this.navigation._applyNavigation(tab.viewId, tab.params as WrapParams<T>);
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
    const tab =
      this.tabs.find((entry) => entry.id === tabId) ??
      // Synthesized fixed tabs live only in visibleTabs until first activated.
      this.visibleTabs.find((entry) => entry.id === tabId);
    if (!tab) return;
    this._activateVisible(tab);
  }

  /**
   * Activates a tab from the visible strip, materializing a synthesized fixed
   * tab into the store first (so activation memory and persistence see it).
   * Order matters: set activeTabId before _applyNavigation so the route-sync
   * reaction writes into the NEW tab (a no-op) instead of clobbering the old one.
   */
  private _activateVisible(tab: AppTabEntry): void {
    let stored = this.tabs.find((entry) => entry.id === tab.id);
    if (!stored) {
      this.tabs.splice(this._insertIndex(tab.viewId, tab.params), 0, tab);
      // Re-resolve: the deep-observable array stores a converted proxy, not
      // the inserted object — the seq stamp must land on the stored entry.
      stored = this.tabs.find((entry) => entry.id === tab.id) ?? tab;
    }
    this._activate(stored);
    this.navigation._applyNavigation(stored.viewId, stored.params as WrapParams<ViewId>);
  }

  closeTab(tabId: string): void {
    const index = this.tabs.findIndex((entry) => entry.id === tabId);
    if (index === -1) return;
    const closed = this.tabs[index];

    // Pick the successor from the strip order BEFORE removal — it may be a
    // synthesized fixed tab (e.g. closing the scope's last dynamic tab lands
    // on a fixed page instead of jumping to another scope).
    let successor: AppTabEntry | undefined;
    if (this.activeTabId === closed.id) {
      const visible = this.visibleTabs;
      const visibleIndex = visible.findIndex((entry) => entry.id === closed.id);
      successor =
        visibleIndex === -1 ? undefined : (visible[visibleIndex + 1] ?? visible[visibleIndex - 1]);
    }

    this.tabs.splice(index, 1);
    for (const listener of this.closeListeners) listener(closed);

    if (this.activeTabId !== closed.id) return;

    const next = successor ?? this.tabs[index] ?? this.tabs[index - 1];
    if (next) {
      this._activateVisible(next);
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
      .map((tab) => ({ ...tab, params: normalizeTabParams(tab.viewId, tab.params ?? {}) }))
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
