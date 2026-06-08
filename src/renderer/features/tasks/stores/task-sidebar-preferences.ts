import { makeAutoObservable } from 'mobx';
import type { TaskSidebarViewSnapshot, TaskViewSnapshot } from '@shared/view-state';
import { type SidebarTab } from '@renderer/features/tasks/types';
import { rpc } from '@renderer/lib/ipc';
import { viewStateCache } from '@renderer/lib/stores/view-state-cache';

export const TASK_SIDEBAR_VIEW_STATE_KEY = 'task-sidebar';

const DEFAULT_SIDEBAR_TAB: SidebarTab = 'conversations';
const DEFAULT_SIDEBAR_COLLAPSED = true;
const DEFAULT_CONTEXT_PANEL_OPEN_SECTION_IDS = ['llm-context', 'memory'];

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

function hasContextPanelSnapshotValue(snapshot: TaskSidebarViewSnapshot | null): boolean {
  return isStringArray(snapshot?.contextPanelOpenSectionIds);
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

function resolveContextPanelOpenSectionIds(
  sharedSnapshot: TaskSidebarViewSnapshot | null
): string[] {
  if (isStringArray(sharedSnapshot?.contextPanelOpenSectionIds)) {
    return normalizeOpenSectionIds(sharedSnapshot.contextPanelOpenSectionIds);
  }
  return [...DEFAULT_CONTEXT_PANEL_OPEN_SECTION_IDS];
}

function resolveSessionPanelOpenSectionIds(
  sharedSnapshot: TaskSidebarViewSnapshot | null
): string[] {
  if (isStringArray(sharedSnapshot?.sessionPanelOpenSectionIds)) {
    return normalizeOpenSectionIds(sharedSnapshot.sessionPanelOpenSectionIds);
  }
  return [...DEFAULT_SESSION_PANEL_OPEN_SECTION_IDS];
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
  contextPanelOpenSectionIds: string[] = [...DEFAULT_CONTEXT_PANEL_OPEN_SECTION_IDS];
  sessionPanelOpenSectionIds: string[] = [...DEFAULT_SESSION_PANEL_OPEN_SECTION_IDS];
  disclosureOpenIds: string[] = [];
  private isHydrated: boolean = false;

  constructor() {
    makeAutoObservable(this);
  }

  get snapshot(): TaskSidebarViewSnapshot {
    return {
      sidebarTab: this.sidebarTab,
      isSidebarCollapsed: this.isSidebarCollapsed,
      contextPanelOpenSectionIds: [...this.contextPanelOpenSectionIds],
      sessionPanelOpenSectionIds: [...this.sessionPanelOpenSectionIds],
      disclosureOpenIds: [...this.disclosureOpenIds],
    };
  }

  hydrate(
    sharedSnapshot: TaskSidebarViewSnapshot | null,
    legacySnapshot: LegacyTaskSidebarSnapshot | null
  ): void {
    if (this.isHydrated) return;

    this.sidebarTab = resolveSidebarTab(sharedSnapshot, legacySnapshot);
    this.isSidebarCollapsed = resolveSidebarCollapsed(sharedSnapshot, legacySnapshot);
    this.contextPanelOpenSectionIds = resolveContextPanelOpenSectionIds(sharedSnapshot);
    this.sessionPanelOpenSectionIds = resolveSessionPanelOpenSectionIds(sharedSnapshot);
    this.disclosureOpenIds = resolveDisclosureOpenIds(sharedSnapshot);
    this.isHydrated = true;

    viewStateCache.set(TASK_SIDEBAR_VIEW_STATE_KEY, this.snapshot);

    if (
      (!hasSidebarSnapshotValue(sharedSnapshot) && hasSidebarSnapshotValue(legacySnapshot)) ||
      !hasContextPanelSnapshotValue(sharedSnapshot) ||
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

  setContextPanelOpenSectionIds(sectionIds: string[]): void {
    const next = normalizeOpenSectionIds(sectionIds);
    if (arraysEqual(this.contextPanelOpenSectionIds, next)) return;
    this.contextPanelOpenSectionIds = next;
    this.persist();
  }

  setContextPanelSectionOpen(sectionId: string, open: boolean): void {
    const sectionIds = new Set(this.contextPanelOpenSectionIds);
    if (open) {
      sectionIds.add(sectionId);
    } else {
      sectionIds.delete(sectionId);
    }
    this.setContextPanelOpenSectionIds([...sectionIds]);
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
