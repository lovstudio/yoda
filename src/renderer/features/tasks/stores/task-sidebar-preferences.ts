import { makeAutoObservable } from 'mobx';
import type { BottomPanelTab, TaskSidebarViewSnapshot } from '@shared/view-state';
import {
  SESSION_PANEL_UNITS,
  type SessionPanelUnit,
  type SidebarTab,
  type SidebarTabGroup,
} from '@renderer/features/tasks/types';

const DEFAULT_SIDEBAR_TAB: SidebarTab = 'conversations';
const DEFAULT_SIDEBAR_COLLAPSED = true;

/** The merged Session panel opens to its Basic blind by default. */
const DEFAULT_SESSION_PANEL_OPEN_SECTION_IDS = ['basic'];

const DEFAULT_BOTTOM_PANEL_OPEN = false;
const DEFAULT_BOTTOM_PANEL_TAB: BottomPanelTab = 'terminals';
const DEFAULT_BOTTOM_PANEL_FULL_WIDTH = true;

function normalizeOpenSectionIds(value: string[]): string[] {
  return Array.from(new Set(value));
}

export class TaskSidebarPreferenceStore {
  sidebarTab: SidebarTab = DEFAULT_SIDEBAR_TAB;
  isSidebarCollapsed: boolean = DEFAULT_SIDEBAR_COLLAPSED;
  sessionPanelOpenSectionIds: string[] = [...DEFAULT_SESSION_PANEL_OPEN_SECTION_IDS];
  sessionPanelUnitOrder: SessionPanelUnit[] = [...SESSION_PANEL_UNITS];
  sessionPanelHiddenUnits: SessionPanelUnit[] = [];
  disclosureOpenIds: string[] = [];
  openSidebarGroups: SidebarTabGroup[] = [];
  isBottomPanelOpen: boolean = DEFAULT_BOTTOM_PANEL_OPEN;
  bottomPanelTab: BottomPanelTab = DEFAULT_BOTTOM_PANEL_TAB;
  openBottomPanelTabs: BottomPanelTab[] = [DEFAULT_BOTTOM_PANEL_TAB];
  isBottomPanelFullWidth: boolean = DEFAULT_BOTTOM_PANEL_FULL_WIDTH;

  constructor() {
    makeAutoObservable(this);
  }

  get snapshot(): TaskSidebarViewSnapshot {
    return {
      sidebarTab: this.sidebarTab,
      isSidebarCollapsed: this.isSidebarCollapsed,
      sessionPanelOpenSectionIds: [...this.sessionPanelOpenSectionIds],
      sessionPanelUnitOrder: [...this.sessionPanelUnitOrder],
      sessionPanelHiddenUnits: [...this.sessionPanelHiddenUnits],
      disclosureOpenIds: [...this.disclosureOpenIds],
      openSidebarGroups: [...this.openSidebarGroups],
      isBottomPanelOpen: this.isBottomPanelOpen,
      bottomPanelTab: this.bottomPanelTab,
      openBottomPanelTabs: [...this.openBottomPanelTabs],
      isBottomPanelFullWidth: this.isBottomPanelFullWidth,
    };
  }

  setSidebarTab(tab: SidebarTab): void {
    if (this.sidebarTab === tab) return;
    this.sidebarTab = tab;
  }

  setSidebarCollapsed(collapsed: boolean): void {
    if (this.isSidebarCollapsed === collapsed) return;
    this.isSidebarCollapsed = collapsed;
  }

  setBottomPanelOpen(open: boolean): void {
    if (this.isBottomPanelOpen === open) return;
    this.isBottomPanelOpen = open;
  }

  setBottomPanelTab(tab: BottomPanelTab): void {
    if (this.bottomPanelTab === tab) return;
    this.bottomPanelTab = tab;
  }

  openBottomPanelTab(tab: BottomPanelTab): void {
    if (this.openBottomPanelTabs.includes(tab)) return;
    this.openBottomPanelTabs = [...this.openBottomPanelTabs, tab];
  }

  closeBottomPanelTab(tab: BottomPanelTab): void {
    if (!this.openBottomPanelTabs.includes(tab)) return;
    this.openBottomPanelTabs = this.openBottomPanelTabs.filter((t) => t !== tab);
  }

  /**
   * Reorder a mode tab to a raw insertion index (computed before removal, as
   * drop zones do).
   */
  reorderBottomPanelTab(tab: BottomPanelTab, toIndex: number): void {
    const from = this.openBottomPanelTabs.indexOf(tab);
    if (from === -1) return;
    const insert = Math.max(
      0,
      Math.min(toIndex > from ? toIndex - 1 : toIndex, this.openBottomPanelTabs.length - 1)
    );
    if (insert === from) return;
    const next = this.openBottomPanelTabs.filter((t) => t !== tab);
    next.splice(insert, 0, tab);
    this.openBottomPanelTabs = next;
  }

  setBottomPanelFullWidth(fullWidth: boolean): void {
    if (this.isBottomPanelFullWidth === fullWidth) return;
    this.isBottomPanelFullWidth = fullWidth;
  }

  openSidebarGroup(group: SidebarTabGroup): void {
    if (this.openSidebarGroups.includes(group)) return;
    this.openSidebarGroups = [...this.openSidebarGroups, group];
  }

  closeSidebarGroup(group: SidebarTabGroup): void {
    if (!this.openSidebarGroups.includes(group)) return;
    this.openSidebarGroups = this.openSidebarGroups.filter((g) => g !== group);
  }

  /**
   * Reorder a feature card to a raw insertion index (computed before removal,
   * as drop zones do).
   */
  reorderSidebarGroup(group: SidebarTabGroup, toIndex: number): void {
    const from = this.openSidebarGroups.indexOf(group);
    if (from === -1) return;
    const insert = Math.max(
      0,
      Math.min(toIndex > from ? toIndex - 1 : toIndex, this.openSidebarGroups.length - 1)
    );
    if (insert === from) return;
    const next = this.openSidebarGroups.filter((g) => g !== group);
    next.splice(insert, 0, group);
    this.openSidebarGroups = next;
  }

  setSessionPanelOpenSectionIds(sectionIds: string[]): void {
    const next = normalizeOpenSectionIds(sectionIds);
    if (arraysEqual(this.sessionPanelOpenSectionIds, next)) return;
    this.sessionPanelOpenSectionIds = next;
  }

  setSessionPanelUnitHidden(unit: SessionPanelUnit, hidden: boolean): void {
    const isHidden = this.sessionPanelHiddenUnits.includes(unit);
    if (hidden === isHidden) return;
    this.sessionPanelHiddenUnits = hidden
      ? [...this.sessionPanelHiddenUnits, unit]
      : this.sessionPanelHiddenUnits.filter((u) => u !== unit);
  }

  /** Restores the default unit order and visibility. */
  resetSessionPanelUnits(): void {
    this.sessionPanelUnitOrder = [...SESSION_PANEL_UNITS];
    this.sessionPanelHiddenUnits = [];
  }

  /** Moves a unit one slot up (-1) or down (+1) in the panel order. */
  moveSessionPanelUnit(unit: SessionPanelUnit, delta: -1 | 1): void {
    const order = [...this.sessionPanelUnitOrder];
    const index = order.indexOf(unit);
    const target = index + delta;
    if (index === -1 || target < 0 || target >= order.length) return;
    [order[index], order[target]] = [order[target], order[index]];
    this.sessionPanelUnitOrder = order;
  }

  isDisclosureOpen(id: string, defaultOpen: boolean): boolean {
    return this.disclosureOpenIds.includes(openMarker(id, true))
      ? true
      : this.disclosureOpenIds.includes(openMarker(id, false))
        ? false
        : defaultOpen;
  }

  setDisclosureOpen(id: string, open: boolean): void {
    // Track both states explicitly so a remembered "closed" wins while this app
    // session is alive, even when the default is "open" (and vice-versa).
    const next = this.disclosureOpenIds.filter(
      (marker) => marker !== openMarker(id, true) && marker !== openMarker(id, false)
    );
    next.push(openMarker(id, open));
    if (arraysEqual(this.disclosureOpenIds, next)) return;
    this.disclosureOpenIds = next;
  }
}

function arraysEqual(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

/** Encodes a disclosure's explicit open/closed choice as a single token. */
function openMarker(id: string, open: boolean): string {
  return `${open ? '+' : '-'}${id}`;
}

export const taskSidebarPreferenceStore = new TaskSidebarPreferenceStore();
