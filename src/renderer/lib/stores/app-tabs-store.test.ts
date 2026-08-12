import { makeAutoObservable } from 'mobx';
import { describe, expect, it, vi } from 'vitest';
import type { ViewId, WrapParams } from '@renderer/app/view-registry';
import {
  AppTabsStore,
  isIndexTab,
  routeKey,
  tabScopeKey,
  type AppTabEntry,
} from '@renderer/lib/stores/app-tabs-store';
import type { NavigationStore } from '@renderer/lib/stores/navigation-store';

function createNavigationStub(): NavigationStore {
  const navigation = {
    currentViewId: 'skills' as ViewId,
    viewParamsStore: { skills: {} },
    navigate: vi.fn(function <T extends ViewId>(
      this: typeof navigation,
      viewId: T,
      params?: WrapParams<T>
    ) {
      this.currentViewId = viewId;
      this.viewParamsStore = { ...this.viewParamsStore, [viewId]: params ?? {} };
    }),
    _applyNavigation: vi.fn(),
  };
  return navigation as unknown as NavigationStore;
}

function createReactiveNavigationStub(
  currentViewId: ViewId,
  viewParamsStore: Record<string, Record<string, unknown>>
): NavigationStore {
  const navigation = makeAutoObservable({
    currentViewId,
    viewParamsStore,
    navigate: vi.fn(function <T extends ViewId>(
      this: {
        currentViewId: ViewId;
        viewParamsStore: Record<string, Record<string, unknown>>;
      },
      viewId: T,
      params?: WrapParams<T>
    ) {
      this.currentViewId = viewId;
      this.viewParamsStore = { ...this.viewParamsStore, [viewId]: params ?? {} };
    }),
    _applyNavigation: vi.fn(function <T extends ViewId>(
      this: {
        currentViewId: ViewId;
        viewParamsStore: Record<string, Record<string, unknown>>;
      },
      viewId: T,
      params?: WrapParams<T>
    ) {
      this.currentViewId = viewId;
      this.viewParamsStore = { ...this.viewParamsStore, [viewId]: params ?? {} };
    }),
  });
  return navigation as unknown as NavigationStore;
}

describe('AppTabsStore navigation history integration', () => {
  it('records opening a skill detail as user-visible navigation', () => {
    const navigation = createNavigationStub();
    const tabs = new AppTabsStore(navigation);

    tabs.openTab('skill', { skillId: 'code', displayName: 'Code' });

    expect(navigation.navigate).toHaveBeenCalledWith('skill', {
      skillId: 'code',
      displayName: 'Code',
    });
    expect(navigation._applyNavigation).not.toHaveBeenCalled();
  });

  it('reuses the active skill tab for an in-detail list selection', () => {
    const navigation = createNavigationStub();
    const tabs = new AppTabsStore(navigation);
    tabs.openTab('skill', { skillId: 'alpha', displayName: 'Alpha' });
    const activeId = tabs.activeTabId;
    vi.mocked(navigation.navigate).mockClear();

    tabs.replaceActiveTab('skill', { skillId: 'beta', displayName: 'Beta' });

    expect(tabs.activeTabId).toBe(activeId);
    expect(tabs.tabs.filter((tab) => tab.viewId === 'skill')).toHaveLength(1);
    expect(tabs.activeTab?.params).toEqual({ skillId: 'beta', displayName: 'Beta' });
    expect(navigation.navigate).toHaveBeenCalledWith('skill', {
      skillId: 'beta',
      displayName: 'Beta',
    });
  });

  it('records explicit tab activation but not the fallback after closing it', () => {
    const navigation = createNavigationStub();
    const tabs = new AppTabsStore(navigation);
    tabs.openTab('skills', {}, { activate: false });
    tabs.openTab('skill', { skillId: 'code', displayName: 'Code' }, { activate: false });

    const skillsTab = tabs.tabs.find((tab) => tab.viewId === 'skills')!;
    const skillTab = tabs.tabs.find((tab) => tab.viewId === 'skill')!;
    tabs.activateTab(skillsTab.id);
    tabs.activateTab(skillTab.id);
    vi.mocked(navigation.navigate).mockClear();

    tabs.closeTab(skillTab.id);

    expect(navigation.navigate).not.toHaveBeenCalled();
    expect(navigation._applyNavigation).toHaveBeenCalledWith('skills', {});
  });
});

describe('AppTabsStore persisted route migration', () => {
  it('moves restored Marketplace app tabs into the Library scope', () => {
    const navigation = createNavigationStub();
    const tabs = new AppTabsStore(navigation);

    tabs.restoreSnapshot({
      tabs: [
        {
          id: 'app-tab',
          viewId: 'marketplace',
          params: { section: 'apps', appId: 'app-1' },
        },
      ],
      activeTabId: 'app-tab',
      stripScope: 'view:library',
    });

    expect(tabs.tabs).toEqual([
      {
        id: 'app-tab',
        viewId: 'library',
        params: { section: 'apps', appId: 'app-1' },
      },
    ]);
    expect(tabs.stripScope).toBe('view:library');
  });
});

describe('AppTabsStore task scope entry', () => {
  it('requires a concrete task target through one explicit navigation', () => {
    const sessionParams = {
      projectId: 'project-1',
      taskId: 'task-1',
      tab: { kind: 'conversation' as const, conversationId: 'conversation-1' },
    };
    const navigation = createNavigationStub();
    const tabs = new AppTabsStore(navigation);
    tabs.restoreSnapshot({
      tabs: [
        { id: 'home-tab', viewId: 'home', params: {}, seq: 2 },
        { id: 'session-tab', viewId: 'task', params: sessionParams, seq: 1 },
      ],
      activeTabId: 'home-tab',
    });
    const opened = tabs.openTaskScope('project-1', 'task-1', sessionParams.tab);

    expect(opened).toBe(true);
    expect(tabs.activeTabId).toBe('session-tab');
    expect(tabs.replayNonce).toBe(1);
    expect(navigation.navigate).toHaveBeenCalledOnce();
    expect(navigation.navigate).toHaveBeenCalledWith('task', sessionParams);
    expect(navigation._applyNavigation).not.toHaveBeenCalled();
    tabs.dispose();
  });

  it('defers a fresh task until provisioning can resolve its target', () => {
    const navigation = createNavigationStub();
    const tabs = new AppTabsStore(navigation);

    expect(tabs.openTaskScope('project-1', 'task-1')).toBe(false);
    expect(navigation.navigate).not.toHaveBeenCalled();

    expect(tabs.openTaskScope('project-1', 'task-1', { kind: 'overview' })).toBe(true);
    expect(navigation.navigate).toHaveBeenCalledOnce();
    expect(navigation.navigate).toHaveBeenCalledWith('task', {
      projectId: 'project-1',
      taskId: 'task-1',
      tab: { kind: 'overview' },
    });
    tabs.dispose();
  });

  it('does not infer a task target from app-tab history', () => {
    const overviewParams = {
      projectId: 'project-1',
      taskId: 'task-1',
      tab: { kind: 'overview' },
    };
    const sessionParams = {
      projectId: 'project-1',
      taskId: 'task-1',
      tab: { kind: 'conversation' as const, conversationId: 'conversation-1' },
    };
    const navigation = createNavigationStub();
    const tabs = new AppTabsStore(navigation);
    tabs.restoreSnapshot({
      tabs: [
        { id: 'overview-tab', viewId: 'task', params: overviewParams, seq: 2 },
        { id: 'session-tab', viewId: 'task', params: sessionParams, seq: 1 },
      ],
      activeTabId: 'overview-tab',
    });

    expect(tabs.openTaskScope('project-1', 'task-1')).toBe(false);
    expect(tabs.activeTabId).toBe('overview-tab');
    expect(navigation.navigate).not.toHaveBeenCalled();
    tabs.dispose();
  });

  it.each([
    ['inactive', 'home-tab'],
    ['active', 'session-tab'],
  ])(
    'moves the strip into a task scope when its history target is sticky and %s',
    (_, activeTabId) => {
      const sessionParams = {
        projectId: 'project-1',
        taskId: 'task-1',
        tab: { kind: 'conversation' as const, conversationId: 'conversation-1' },
      };
      const navigation = createNavigationStub();
      const tabs = new AppTabsStore(navigation);
      tabs.restoreSnapshot({
        tabs: [
          { id: 'home-tab', viewId: 'home', params: {}, seq: 2 },
          { id: 'session-tab', viewId: 'task', params: sessionParams, seq: 1 },
        ],
        activeTabId,
        stickyTabIds: ['session-tab'],
        stripScope: 'view:home',
      });

      expect(tabs.openTaskScope('project-1', 'task-1', sessionParams.tab)).toBe(true);

      expect(tabs.activeTabId).toBe('session-tab');
      expect(tabs.stripScope).toBe(tabScopeKey('task', sessionParams));
      expect(tabs.visibleTabs.every((tab) => tab.viewId === 'task')).toBe(true);
      expect(navigation.navigate).toHaveBeenCalledOnce();
      tabs.dispose();
    }
  );

  it('switches tasks through the supplied history targets without a target-less route', () => {
    const taskAOverview = {
      projectId: 'project-1',
      taskId: 'task-a',
      tab: { kind: 'overview' as const },
    };
    const taskASession = {
      projectId: 'project-1',
      taskId: 'task-a',
      tab: { kind: 'conversation' as const, conversationId: 'conversation-a' },
    };
    const taskBOverview = {
      projectId: 'project-1',
      taskId: 'task-b',
      tab: { kind: 'overview' as const },
    };
    const navigation = createReactiveNavigationStub('home', { home: {} });
    const tabs = new AppTabsStore(navigation);
    tabs.restoreSnapshot({
      tabs: [
        { id: 'home-tab', viewId: 'home', params: {}, seq: 1 },
        { id: 'task-a-overview', viewId: 'task', params: taskAOverview, seq: 2 },
        { id: 'task-a-session', viewId: 'task', params: taskASession, seq: 4 },
        { id: 'task-b-overview', viewId: 'task', params: taskBOverview, seq: 3 },
      ],
      activeTabId: 'home-tab',
    });
    tabs.start();

    expect(tabs.openTaskScope('project-1', 'task-a', taskASession.tab)).toBe(true);
    expect(tabs.activeTabId).toBe('task-a-session');
    expect(navigation.viewParamsStore.task).toEqual(taskASession);

    expect(tabs.openTaskScope('project-1', 'task-b', taskBOverview.tab)).toBe(true);
    expect(tabs.activeTabId).toBe('task-b-overview');

    expect(tabs.openTaskScope('project-1', 'task-a', taskASession.tab)).toBe(true);
    expect(tabs.activeTabId).toBe('task-a-session');
    expect(navigation.viewParamsStore.task).toEqual(taskASession);
    tabs.dispose();
  });

  it('restores the task scope session with the latest activation sequence', () => {
    const overviewParams = {
      projectId: 'project-1',
      taskId: 'task-1',
      tab: { kind: 'overview' },
    };
    const sessionParams = {
      projectId: 'project-1',
      taskId: 'task-1',
      tab: { kind: 'conversation', conversationId: 'conversation-1' },
    };
    const navigation = createReactiveNavigationStub('home', { home: {} });
    const tabs = new AppTabsStore(navigation);
    tabs.restoreSnapshot({
      tabs: [
        { id: 'home-tab', viewId: 'home', params: {}, seq: 3 },
        { id: 'overview-tab', viewId: 'task', params: overviewParams, seq: 1 },
        { id: 'session-tab', viewId: 'task', params: sessionParams, seq: 2 },
      ],
      activeTabId: 'home-tab',
    });
    tabs.start();

    navigation.navigate('task', { projectId: 'project-1', taskId: 'task-1' });

    expect(tabs.activeTabId).toBe('session-tab');
    expect(tabs.replayNonce).toBe(1);
    expect(navigation.viewParamsStore.task).toEqual(sessionParams);
    tabs.dispose();
  });

  it('replays the remembered session when the active task row is clicked again', () => {
    const sessionParams = {
      projectId: 'project-1',
      taskId: 'task-1',
      tab: { kind: 'conversation', conversationId: 'conversation-1' },
    };
    const navigation = createReactiveNavigationStub('task', { task: sessionParams });
    const tabs = new AppTabsStore(navigation);
    tabs.restoreSnapshot({
      tabs: [{ id: 'session-tab', viewId: 'task', params: sessionParams, seq: 2 }],
      activeTabId: 'session-tab',
    });
    tabs.start();

    navigation.navigate('task', { projectId: 'project-1', taskId: 'task-1' });

    expect(tabs.activeTabId).toBe('session-tab');
    expect(tabs.replayNonce).toBe(1);
    expect(navigation.viewParamsStore.task).toEqual(sessionParams);
    tabs.dispose();
  });

  it('replaces route sync when the retained app state is started again', () => {
    const sessionParams = {
      projectId: 'project-1',
      taskId: 'task-1',
      tab: { kind: 'conversation', conversationId: 'conversation-1' },
    };
    const navigation = createReactiveNavigationStub('home', { home: {} });
    const tabs = new AppTabsStore(navigation);
    tabs.restoreSnapshot({
      tabs: [
        { id: 'home-tab', viewId: 'home', params: {}, seq: 1 },
        { id: 'session-tab', viewId: 'task', params: sessionParams, seq: 2 },
      ],
      activeTabId: 'home-tab',
    });

    tabs.start();
    tabs.start();
    navigation.navigate('task', { projectId: 'project-1', taskId: 'task-1' });

    expect(tabs.activeTabId).toBe('session-tab');
    expect(tabs.replayNonce).toBe(1);
    tabs.dispose();
  });
});

describe('skill comparison tabs', () => {
  it('deduplicates by the ordered skill pair and ignores display labels', () => {
    const first = routeKey('skillCompare', {
      baseSkillId: 'alpha',
      targetSkillId: 'beta',
      baseDisplayName: 'Alpha',
      targetDisplayName: 'Beta',
    });
    const relabeled = routeKey('skillCompare', {
      baseSkillId: 'alpha',
      targetSkillId: 'beta',
      baseDisplayName: 'Renamed Alpha',
      targetDisplayName: 'Renamed Beta',
    });
    const reversed = routeKey('skillCompare', {
      baseSkillId: 'beta',
      targetSkillId: 'alpha',
    });

    expect(first).toBe(relabeled);
    expect(reversed).not.toBe(first);
  });

  it('places comparisons in the skills scope as closeable tabs', () => {
    const tab: AppTabEntry = {
      id: 'comparison',
      viewId: 'skillCompare',
      params: { baseSkillId: 'alpha', targetSkillId: 'beta' },
    };

    expect(tabScopeKey(tab.viewId, tab.params)).toBe('view:skills');
    expect(isIndexTab(tab)).toBe(false);
  });
});

describe('Feature workspace tabs', () => {
  it('keeps Feature selection inside one project page tab', () => {
    const first = routeKey('project', {
      projectId: 'project-1',
      view: 'features',
      featureId: 'feature-1',
    });
    const second = routeKey('project', {
      projectId: 'project-1',
      view: 'features',
      featureId: 'feature-2',
    });

    expect(first).toBe(second);
    expect(first).not.toBe(routeKey('project', { projectId: 'project-1', view: 'issues' }));
  });
});
