import { makeAutoObservable } from 'mobx';
import type { ViewId, WrapParams } from '@renderer/app/view-registry';

const MAX_STACK_SIZE = 50;

export type HistoryEntry =
  | { kind: 'view'; viewId: ViewId; params: WrapParams<ViewId> }
  | { kind: 'tab'; projectId: string; taskId: string; tabId: string };

function normalizeValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeValue);
  if (!value || typeof value !== 'object') return value;

  return Object.keys(value as Record<string, unknown>)
    .sort()
    .reduce<Record<string, unknown>>((acc, key) => {
      const next = normalizeValue((value as Record<string, unknown>)[key]);
      if (next !== undefined) acc[key] = next;
      return acc;
    }, {});
}

function paramsEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(normalizeValue(a ?? {})) === JSON.stringify(normalizeValue(b ?? {}));
}

function entriesEqual(a: HistoryEntry, b: HistoryEntry): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'view' && b.kind === 'view') {
    return a.viewId === b.viewId && paramsEqual(a.params, b.params);
  }
  if (a.kind === 'tab' && b.kind === 'tab') {
    return a.projectId === b.projectId && a.taskId === b.taskId && a.tabId === b.tabId;
  }
  return false;
}

function flattenWithIndex(
  entries: HistoryEntry[],
  preferredIndex: number
): { entries: HistoryEntry[]; index: number } {
  const flattened: HistoryEntry[] = [];
  let index = -1;

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]!;
    const duplicate = flattened.length > 0 && entriesEqual(entry, flattened[flattened.length - 1]!);
    if (duplicate) {
      if (i === preferredIndex) index = flattened.length - 1;
      continue;
    }

    flattened.push(entry);
    if (i === preferredIndex) index = flattened.length - 1;
  }

  if (flattened.length === 0) return { entries: flattened, index: -1 };
  return { entries: flattened, index: index === -1 ? flattened.length - 1 : index };
}

/**
 * Tracks a chronological back/forward navigation stack spanning both
 * view-level and tab-level navigations.
 *
 * - `push()` is a no-op while `back()`/`forward()` are applying an entry,
 *   which prevents reactive observers (e.g. TaskViewStore's tab reaction)
 *   from recording the restoration as a new entry.
 * - `prune()` removes entries for deleted entities and is a hook point for
 *   future entity-cleanup; it is not called in the initial iteration.
 */
export class NavigationHistoryStore {
  /** Append-only log; not observable — only `index` drives reactivity. */
  entries: HistoryEntry[] = [];
  index = -1;
  private revision = 0;

  /** Set to true while back/forward is being applied. Suppresses push(). */
  private navigating = false;

  constructor() {
    makeAutoObservable(this, {
      entries: false,
      canGoBack: true,
      canGoForward: true,
    });
  }

  get canGoBack(): boolean {
    void this.revision;
    return this.index > 0;
  }

  get canGoForward(): boolean {
    void this.revision;
    return this.index < this.entries.length - 1;
  }

  get currentEntry(): HistoryEntry | undefined {
    void this.revision;
    return this.entries[this.index];
  }

  /**
   * Finds the most recently visited internal page for a task on the current
   * history branch. Entries after the cursor are forward-history and must not
   * affect a new sidebar navigation.
   */
  lastTaskTab(projectId: string, taskId: string): string | undefined {
    for (let i = this.index; i >= 0; i--) {
      const entry = this.entries[i];
      if (entry?.kind === 'tab' && entry.projectId === projectId && entry.taskId === taskId) {
        return entry.tabId;
      }
    }
    return undefined;
  }

  pushNavigation(currentEntry: HistoryEntry | undefined, nextEntry: HistoryEntry): void {
    if (this.navigating) return;
    if (currentEntry && entriesEqual(currentEntry, nextEntry)) return;

    if (this.entries.length === 0 && currentEntry) {
      this.entries.push(currentEntry);
      this.index = 0;
      this.revision++;
    }

    this.push(nextEntry);
  }

  push(entry: HistoryEntry): void {
    if (this.navigating) return;

    // Skip if identical to current entry (e.g. rapid re-activation of same tab)
    const current = this.entries[this.index];
    if (current && entriesEqual(current, entry)) return;

    // Truncate forward stack
    this.entries.splice(this.index + 1);
    this.entries.push(entry);

    // Bound to max size: drop oldest entry when over limit
    if (this.entries.length > MAX_STACK_SIZE) {
      this.entries.shift();
    } else {
      this.index++;
    }
    this.revision++;
  }

  replaceCurrent(
    entry: HistoryEntry,
    predicate?: (currentEntry: HistoryEntry) => boolean
  ): boolean {
    if (this.navigating) return false;

    const currentEntry = this.entries[this.index];
    if (!currentEntry) return false;
    if (predicate && !predicate(currentEntry)) return false;
    if (entriesEqual(currentEntry, entry)) return true;

    this.entries[this.index] = entry;
    const flattened = flattenWithIndex(this.entries, this.index);
    this.entries = flattened.entries;
    this.index = flattened.index;
    this.revision++;
    return true;
  }

  back(apply: (entry: HistoryEntry) => void): void {
    if (!this.canGoBack) return;
    this.index--;
    this.navigating = true;
    try {
      apply(this.entries[this.index]!);
    } finally {
      this.navigating = false;
    }
  }

  forward(apply: (entry: HistoryEntry) => void): void {
    if (!this.canGoForward) return;
    this.index++;
    this.navigating = true;
    try {
      apply(this.entries[this.index]!);
    } finally {
      this.navigating = false;
    }
  }

  /**
   * Removes all entries matching the predicate, then collapses adjacent
   * identical entries so no-op back steps are not created.
   * The cursor is clamped to the surviving entry nearest the removed position.
   *
   * Hook point for future entity-cleanup (deleted conversations, closed tabs, etc.).
   */
  prune(predicate: (entry: HistoryEntry) => boolean): void {
    const currentEntry = this.entries[this.index];
    const filtered = this.entries.filter((e) => !predicate(e));
    const preservedIndex = currentEntry ? filtered.indexOf(currentEntry) : -1;
    const fallbackIndex =
      filtered.length === 0 ? -1 : Math.max(0, Math.min(this.index, filtered.length - 1));
    const flattened = flattenWithIndex(
      filtered,
      preservedIndex === -1 ? fallbackIndex : preservedIndex
    );
    this.entries = flattened.entries;
    this.index =
      this.entries.length === 0
        ? -1
        : Math.max(0, Math.min(flattened.index, this.entries.length - 1));
    this.revision++;
  }
}
