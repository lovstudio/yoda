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
