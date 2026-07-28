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

describe('AppTabsStore task scope entry', () => {
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
