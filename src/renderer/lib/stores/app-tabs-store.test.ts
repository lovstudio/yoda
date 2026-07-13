import { describe, expect, it } from 'vitest';
import { isIndexTab, routeKey, tabScopeKey, type AppTabEntry } from './app-tabs-store';

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
