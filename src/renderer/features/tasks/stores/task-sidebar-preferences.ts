import { makeAutoObservable } from 'mobx';
import type { BottomPanelTab, TaskSidebarViewSnapshot, TaskViewSnapshot } from '@shared/view-state';
import {
  isSessionPanelUnit,
  isSidebarTabGroup,
  SESSION_PANEL_UNITS,
  type SessionPanelUnit,
  type SidebarTab,
  type SidebarTabGroup,
} from '@renderer/features/tasks/types';
import { rpc } from '@renderer/lib/ipc';
import { viewStateCache } from '@renderer/lib/stores/view-state-cache';

export const TASK_SIDEBAR_VIEW_STATE_KEY = 'task-sidebar';

const DEFAULT_SIDEBAR_TAB: SidebarTab = 'conversations';
const DEFAULT_SIDEBAR_COLLAPSED = true;

/** The merged Session panel opens to its Basic blind by default. */
const DEFAULT_SESSION_PANEL_OPEN_SECTION_IDS = ['basic'];

const DEFAULT_BOTTOM_PANEL_OPEN = false;
const DEFAULT_BOTTOM_PANEL_TAB: BottomPanelTab = 'terminals';

type LegacyTaskSidebarSnapshot = Pick<
  TaskViewSnapshot,
  'sidebarTab' | 'isSidebarCollapsed' | 'isTerminalDrawerOpen' | 'bottomPanelTab'
>;

function isBottomPanelTab(value: unknown): value is BottomPanelTab {
  return value === 'terminals' || value === 'scripts' || value === 'session';
}

function isSidebarTab(value: unknown): value is SidebarTab {
  return (
    value === 'session' ||
    value === 'task' ||
    value === 'conversations' ||
    value === 'changes' ||
    value === 'files' ||
    value === 'context' ||
    value === 'hooks' ||
    value === 'rename'
  );
}

function hasSidebarSnapshotValue(
  snapshot: TaskSidebarViewSnapshot | LegacyTaskSidebarSnapshot | null
): boolean {
  return isSidebarTab(snapshot?.sidebarTab) || typeof snapshot?.isSidebarCollapsed === 'boolean';
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function hasSessionPanelSnapshotValue(snapshot: TaskSidebarViewSnapshot | null): boolean {
  return isStringArray(snapshot?.sessionPanelOpenSectionIds);
}

function hasDisclosureSnapshotValue(snapshot: TaskSidebarViewSnapshot | null): boolean {
  return isStringArray(snapshot?.disclosureOpenIds);
}

function hasBottomPanelSnapshotValue(snapshot: TaskSidebarViewSnapshot | null): boolean {
  return (
    typeof snapshot?.isBottomPanelOpen === 'boolean' || isBottomPanelTab(snapshot?.bottomPanelTab)
  );
}

function resolveSidebarTab(
  sharedSnapshot: TaskSidebarViewSnapshot | null,
  legacySnapshot: LegacyTaskSidebarSnapshot | null
): SidebarTab {
  if (isSidebarTab(sharedSnapshot?.sidebarTab)) return sharedSnapshot.sidebarTab;
  if (isSidebarTab(legacySnapshot?.sidebarTab)) return legacySnapshot.sidebarTab;
  return DEFAULT_SIDEBAR_TAB;
}

function resolveSidebarCollapsed(
  sharedSnapshot: TaskSidebarViewSnapshot | null,
  legacySnapshot: LegacyTaskSidebarSnapshot | null
): boolean {
  if (typeof sharedSnapshot?.isSidebarCollapsed === 'boolean') {
    return sharedSnapshot.isSidebarCollapsed;
  }
  if (typeof legacySnapshot?.isSidebarCollapsed === 'boolean') {
    return legacySnapshot.isSidebarCollapsed;
  }
  return DEFAULT_SIDEBAR_COLLAPSED;
}

function normalizeOpenSectionIds(value: string[]): string[] {
  return Array.from(new Set(value));
}

function resolveSessionPanelOpenSectionIds(
  sharedSnapshot: TaskSidebarViewSnapshot | null
): string[] {
  if (isStringArray(sharedSnapshot?.sessionPanelOpenSectionIds)) {
    // The legacy "status" blind has been folded into the Basic blind.
    return normalizeOpenSectionIds(
      sharedSnapshot.sessionPanelOpenSectionIds.map((id) => (id === 'status' ? 'basic' : id))
    );
  }
  return [...DEFAULT_SESSION_PANEL_OPEN_SECTION_IDS];
}

function resolveOpenSidebarGroups(
  sharedSnapshot: TaskSidebarViewSnapshot | null
): SidebarTabGroup[] {
  if (isStringArray(sharedSnapshot?.openSidebarGroups)) {
    // The legacy "harness" card has been folded into the Session panel.
    const groups = sharedSnapshot.openSidebarGroups
      .map((group) => (group === 'harness' ? 'session' : group))
      .filter(isSidebarTabGroup);
    return Array.from(new Set(groups));
  }
  // Feature cards default to NOT being in the strip — the user adds the ones
  // they need via the "+" picker.
  return [];
}

function resolveDisclosureOpenIds(sharedSnapshot: TaskSidebarViewSnapshot | null): string[] {
  if (isStringArray(sharedSnapshot?.disclosureOpenIds)) {
    return normalizeOpenSectionIds(sharedSnapshot.disclosureOpenIds);
  }
  return [];
}

/**
 * Normalizes a persisted unit order: drop unknown ids and duplicates, then
 * insert any units missing from the snapshot at their DEFAULT position
 * relative to the units the user has ordered. Appending them at the end would
 * push e.g. 概要 (persisted, last by default) in front of sections added in a
 * later app version.
 */
function normalizeUnitOrder(value: unknown): SessionPanelUnit[] {
  const persisted = (isStringArray(value) ? value : []).filter(isSessionPanelUnit);
  const order = [...new Set(persisted)];
  const seen = new Set(order);
  for (const unit of SESSION_PANEL_UNITS) {
    if (seen.has(unit)) continue;
    const defaultIndex = SESSION_PANEL_UNITS.indexOf(unit);
    // Right after the last known unit that precedes it in the default order.
    let insertAt = 0;
    for (let index = 0; index < order.length; index += 1) {
      if (SESSION_PANEL_UNITS.indexOf(order[index]) < defaultIndex) insertAt = index + 1;
    }
    order.splice(insertAt, 0, unit);
    seen.add(unit);
  }
  return order;
}

function resolveSessionPanelUnitOrder(
  sharedSnapshot: TaskSidebarViewSnapshot | null
): SessionPanelUnit[] {
  return normalizeUnitOrder(sharedSnapshot?.sessionPanelUnitOrder);
}

function resolveSessionPanelHiddenUnits(
  sharedSnapshot: TaskSidebarViewSnapshot | null
): SessionPanelUnit[] {
  if (!isStringArray(sharedSnapshot?.sessionPanelHiddenUnits)) return [];
  return [...new Set(sharedSnapshot.sessionPanelHiddenUnits.filter(isSessionPanelUnit))];
}

function resolveBottomPanelOpen(
  sharedSnapshot: TaskSidebarViewSnapshot | null,
  legacySnapshot: LegacyTaskSidebarSnapshot | null
): boolean {
  if (typeof sharedSnapshot?.isBottomPanelOpen === 'boolean') {
    return sharedSnapshot.isBottomPanelOpen;
  }
  // Legacy: the open state used to live per-task in TaskViewSnapshot.
  if (typeof legacySnapshot?.isTerminalDrawerOpen === 'boolean') {
    return legacySnapshot.isTerminalDrawerOpen;
  }
  return DEFAULT_BOTTOM_PANEL_OPEN;
}

function resolveBottomPanelTab(
  sharedSnapshot: TaskSidebarViewSnapshot | null,
  legacySnapshot: LegacyTaskSidebarSnapshot | null
): BottomPanelTab {
  if (isBottomPanelTab(sharedSnapshot?.bottomPanelTab)) return sharedSnapshot.bottomPanelTab;
  if (isBottomPanelTab(legacySnapshot?.bottomPanelTab)) return legacySnapshot.bottomPanelTab;
  return DEFAULT_BOTTOM_PANEL_TAB;
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
  private isHydrated: boolean = false;

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
    };
  }

  hydrate(
    sharedSnapshot: TaskSidebarViewSnapshot | null,
    legacySnapshot: LegacyTaskSidebarSnapshot | null
  ): void {
    if (this.isHydrated) return;

    this.sidebarTab = resolveSidebarTab(sharedSnapshot, legacySnapshot);
    this.isSidebarCollapsed = resolveSidebarCollapsed(sharedSnapshot, legacySnapshot);
    this.sessionPanelOpenSectionIds = resolveSessionPanelOpenSectionIds(sharedSnapshot);
    this.sessionPanelUnitOrder = resolveSessionPanelUnitOrder(sharedSnapshot);
    this.sessionPanelHiddenUnits = resolveSessionPanelHiddenUnits(sharedSnapshot);
    this.disclosureOpenIds = resolveDisclosureOpenIds(sharedSnapshot);
    this.openSidebarGroups = resolveOpenSidebarGroups(sharedSnapshot);
    this.isBottomPanelOpen = resolveBottomPanelOpen(sharedSnapshot, legacySnapshot);
    this.bottomPanelTab = resolveBottomPanelTab(sharedSnapshot, legacySnapshot);
    this.isHydrated = true;

    viewStateCache.set(TASK_SIDEBAR_VIEW_STATE_KEY, this.snapshot);

    if (
      (!hasSidebarSnapshotValue(sharedSnapshot) && hasSidebarSnapshotValue(legacySnapshot)) ||
      !hasSessionPanelSnapshotValue(sharedSnapshot) ||
      !hasDisclosureSnapshotValue(sharedSnapshot) ||
      !hasBottomPanelSnapshotValue(sharedSnapshot)
    ) {
      this.persist();
    }
  }

  setSidebarTab(tab: SidebarTab): void {
    if (this.sidebarTab === tab) return;
    this.sidebarTab = tab;
    this.persist();
  }

  setSidebarCollapsed(collapsed: boolean): void {
    if (this.isSidebarCollapsed === collapsed) return;
    this.isSidebarCollapsed = collapsed;
    this.persist();
  }

  setBottomPanelOpen(open: boolean): void {
    if (this.isBottomPanelOpen === open) return;
    this.isBottomPanelOpen = open;
    this.persist();
  }

  setBottomPanelTab(tab: BottomPanelTab): void {
    if (this.bottomPanelTab === tab) return;
    this.bottomPanelTab = tab;
    this.persist();
  }

  openSidebarGroup(group: SidebarTabGroup): void {
    if (this.openSidebarGroups.includes(group)) return;
    this.openSidebarGroups = [...this.openSidebarGroups, group];
    this.persist();
  }

  closeSidebarGroup(group: SidebarTabGroup): void {
    if (!this.openSidebarGroups.includes(group)) return;
    this.openSidebarGroups = this.openSidebarGroups.filter((g) => g !== group);
    this.persist();
  }

  setSessionPanelOpenSectionIds(sectionIds: string[]): void {
    const next = normalizeOpenSectionIds(sectionIds);
    if (arraysEqual(this.sessionPanelOpenSectionIds, next)) return;
    this.sessionPanelOpenSectionIds = next;
    this.persist();
  }

  setSessionPanelUnitHidden(unit: SessionPanelUnit, hidden: boolean): void {
    const isHidden = this.sessionPanelHiddenUnits.includes(unit);
    if (hidden === isHidden) return;
    this.sessionPanelHiddenUnits = hidden
      ? [...this.sessionPanelHiddenUnits, unit]
      : this.sessionPanelHiddenUnits.filter((u) => u !== unit);
    this.persist();
  }

  /** Restores the default unit order and visibility. */
  resetSessionPanelUnits(): void {
    this.sessionPanelUnitOrder = [...SESSION_PANEL_UNITS];
    this.sessionPanelHiddenUnits = [];
    this.persist();
  }

  /** Moves a unit one slot up (-1) or down (+1) in the panel order. */
  moveSessionPanelUnit(unit: SessionPanelUnit, delta: -1 | 1): void {
    const order = [...this.sessionPanelUnitOrder];
    const index = order.indexOf(unit);
    const target = index + delta;
    if (index === -1 || target < 0 || target >= order.length) return;
    [order[index], order[target]] = [order[target], order[index]];
    this.sessionPanelUnitOrder = order;
    this.persist();
  }

  isDisclosureOpen(id: string, defaultOpen: boolean): boolean {
    return this.disclosureOpenIds.includes(openMarker(id, true))
      ? true
      : this.disclosureOpenIds.includes(openMarker(id, false))
        ? false
        : defaultOpen;
  }

  setDisclosureOpen(id: string, open: boolean): void {
    // Persist both states explicitly so a remembered "closed" survives even when
    // the default is "open" (and vice-versa).
    const next = this.disclosureOpenIds.filter(
      (marker) => marker !== openMarker(id, true) && marker !== openMarker(id, false)
    );
    next.push(openMarker(id, open));
    if (arraysEqual(this.disclosureOpenIds, next)) return;
    this.disclosureOpenIds = next;
    this.persist();
  }

  private persist(): void {
    const snapshot = this.snapshot;
    viewStateCache.set(TASK_SIDEBAR_VIEW_STATE_KEY, snapshot);
    void rpc.viewState.save(TASK_SIDEBAR_VIEW_STATE_KEY, snapshot);
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
