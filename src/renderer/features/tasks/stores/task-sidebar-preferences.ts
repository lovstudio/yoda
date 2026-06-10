import { makeAutoObservable } from 'mobx';
import type { TaskSidebarViewSnapshot, TaskViewSnapshot } from '@shared/view-state';
import {
  isSidebarTabGroup,
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

type LegacyTaskSidebarSnapshot = Pick<TaskViewSnapshot, 'sidebarTab' | 'isSidebarCollapsed'>;

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
    return normalizeOpenSectionIds(sharedSnapshot.sessionPanelOpenSectionIds);
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

export class TaskSidebarPreferenceStore {
  sidebarTab: SidebarTab = DEFAULT_SIDEBAR_TAB;
  isSidebarCollapsed: boolean = DEFAULT_SIDEBAR_COLLAPSED;
  sessionPanelOpenSectionIds: string[] = [...DEFAULT_SESSION_PANEL_OPEN_SECTION_IDS];
  disclosureOpenIds: string[] = [];
  openSidebarGroups: SidebarTabGroup[] = [];
  private isHydrated: boolean = false;

  constructor() {
    makeAutoObservable(this);
  }

  get snapshot(): TaskSidebarViewSnapshot {
    return {
      sidebarTab: this.sidebarTab,
      isSidebarCollapsed: this.isSidebarCollapsed,
      sessionPanelOpenSectionIds: [...this.sessionPanelOpenSectionIds],
      disclosureOpenIds: [...this.disclosureOpenIds],
      openSidebarGroups: [...this.openSidebarGroups],
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
    this.disclosureOpenIds = resolveDisclosureOpenIds(sharedSnapshot);
    this.openSidebarGroups = resolveOpenSidebarGroups(sharedSnapshot);
    this.isHydrated = true;

    viewStateCache.set(TASK_SIDEBAR_VIEW_STATE_KEY, this.snapshot);

    if (
      (!hasSidebarSnapshotValue(sharedSnapshot) && hasSidebarSnapshotValue(legacySnapshot)) ||
      !hasSessionPanelSnapshotValue(sharedSnapshot) ||
      !hasDisclosureSnapshotValue(sharedSnapshot)
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
