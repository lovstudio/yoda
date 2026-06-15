import { describe, expect, it } from 'vitest';
import { SESSION_PANEL_UNITS } from '@renderer/features/tasks/types';
import { TaskSidebarPreferenceStore } from './task-sidebar-preferences';

describe('TaskSidebarPreferenceStore', () => {
  it('starts from runtime defaults instead of restored task state', () => {
    const store = new TaskSidebarPreferenceStore();

    expect(store.snapshot).toEqual({
      sidebarTab: 'conversations',
      isSidebarCollapsed: true,
      sessionPanelOpenSectionIds: ['basic'],
      sessionPanelUnitOrder: [...SESSION_PANEL_UNITS],
      sessionPanelHiddenUnits: [],
      disclosureOpenIds: [],
      openSidebarGroups: [],
      isBottomPanelOpen: false,
      bottomPanelTab: 'terminals',
      openBottomPanelTabs: ['terminals'],
      isBottomPanelFullWidth: true,
    });
  });

  it('keeps sidebar chrome independent from a specific task instance', () => {
    const store = new TaskSidebarPreferenceStore();

    store.setSidebarTab('files');
    store.setSidebarCollapsed(false);
    store.openSidebarGroup('files');
    store.setBottomPanelOpen(true);
    store.setBottomPanelTab('session');
    store.openBottomPanelTab('session');

    expect(store.snapshot).toEqual(
      expect.objectContaining({
        sidebarTab: 'files',
        isSidebarCollapsed: false,
        openSidebarGroups: ['files'],
        isBottomPanelOpen: true,
        bottomPanelTab: 'session',
        openBottomPanelTabs: ['terminals', 'session'],
      })
    );
  });

  it('updates session panel accordion state in memory only', () => {
    const store = new TaskSidebarPreferenceStore();

    store.setSessionPanelOpenSectionIds(['hooks', 'hooks']);
    store.setSessionPanelUnitHidden('tools', true);
    store.moveSessionPanelUnit('tools', -1);
    store.resetSessionPanelUnits();

    expect(store.sessionPanelOpenSectionIds).toEqual(['hooks']);
    expect(store.sessionPanelHiddenUnits).toEqual([]);
    expect(store.sessionPanelUnitOrder).toEqual([...SESSION_PANEL_UNITS]);
  });

  it('tracks ad-hoc disclosure open state, honoring per-id defaults', () => {
    const store = new TaskSidebarPreferenceStore();

    expect(store.isDisclosureOpen('a', true)).toBe(true);
    expect(store.isDisclosureOpen('a', false)).toBe(false);

    store.setDisclosureOpen('a', false);
    expect(store.isDisclosureOpen('a', true)).toBe(false);
    expect(store.disclosureOpenIds).toEqual(['-a']);

    store.setDisclosureOpen('a', true);
    expect(store.isDisclosureOpen('a', false)).toBe(true);
    expect(store.disclosureOpenIds).toEqual(['+a']);
  });
});
