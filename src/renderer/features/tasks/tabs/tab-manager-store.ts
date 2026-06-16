import { action, autorun, computed, makeObservable, observable, reaction } from 'mobx';
import type { GitChangeStatus, GitObjectRef } from '@shared/git';
import type { TaskWindowTabTarget } from '@shared/task-window';
import type { ActiveFile, TabDescriptor, TabManagerSnapshot } from '@shared/view-state';
import type {
  ConversationManagerStore,
  ConversationStore,
} from '@renderer/features/tasks/conversations/conversation-manager';
import { DiffTabStore } from '@renderer/features/tasks/tabs/diff-tab-store';
import { FileTabStore } from '@renderer/features/tasks/tabs/file-tab-store';
import type { FileRendererData } from '@renderer/features/tasks/types';
import { modelRegistry } from '@renderer/lib/monaco/monaco-model-registry';
import { buildMonacoModelPath } from '@renderer/lib/monaco/monacoModelPath';
import { scheduleTerminalRelayout } from '@renderer/lib/pty/terminal-relayout';
import type { Snapshottable } from '@renderer/lib/stores/snapshottable';
import {
  addTabId,
  removeTabId,
  reorderTabIds,
  setNextTabActive as tabUtilsSetNextTabActive,
  setPreviousTabActive as tabUtilsSetPreviousTabActive,
  setTabActiveIndex as tabUtilsSetTabActiveIndex,
} from '@renderer/lib/stores/tab-utils';
import { log } from '@renderer/utils/logger';
import { setTelemetryConversationScope } from '@renderer/utils/telemetry-scope';

// ---------------------------------------------------------------------------
// Conversation tab entry — thin reference into ConversationManagerStore
// ---------------------------------------------------------------------------

export class ConversationTabEntry {
  readonly kind = 'conversation' as const;
  readonly tabId: string;
  conversationId: string;
  isPreview: boolean;

  constructor(conversationId: string, isPreview: boolean, tabId?: string) {
    this.tabId = tabId ?? crypto.randomUUID();
    this.conversationId = conversationId;
    this.isPreview = isPreview;
    makeObservable(this, {
      conversationId: observable,
      isPreview: observable,
      pin: action,
    });
  }

  pin(): void {
    this.isPreview = false;
  }
}

/**
 * The fixed task-overview tab. There is at most one, it is always pinned to the
 * first position, cannot be closed/reordered, and is synthesized fresh on each
 * mount — it is intentionally excluded from the persisted snapshot.
 */
export class OverviewTabEntry {
  readonly kind = 'overview' as const;
  readonly tabId = OVERVIEW_TAB_ID;
  readonly isPreview = false;
}

/** Stable id for the singleton overview tab. */
export const OVERVIEW_TAB_ID = 'overview';

export type TabEntry = FileTabStore | DiffTabStore | ConversationTabEntry | OverviewTabEntry;

// ---------------------------------------------------------------------------
// Resolved tabs — enriched with live store references and derived state
// ---------------------------------------------------------------------------

export type ResolvedConversationTab = {
  kind: 'conversation';
  tabId: string;
  conversationId: string;
  store: ConversationStore;
  isPreview: boolean;
  isActive: boolean;
};

export type ResolvedFileTab = {
  kind: 'file';
  tabId: string;
  path: string;
  isPreview: boolean;
  isDirty: boolean;
  bufferUri: string;
  isActive: boolean;
};

export type ResolvedDiffTab = {
  kind: 'diff';
  tabId: string;
  path: string;
  diffGroup: 'disk' | 'staged' | 'git' | 'pr';
  originalRef: GitObjectRef;
  modifiedRef?: GitObjectRef;
  prNumber?: number;
  status?: GitChangeStatus;
  isPreview: boolean;
  isActive: boolean;
};

export type ResolvedOverviewTab = {
  kind: 'overview';
  tabId: string;
  isPreview: false;
  isActive: boolean;
};

export type ResolvedTab =
  | ResolvedConversationTab
  | ResolvedFileTab
  | ResolvedDiffTab
  | ResolvedOverviewTab;

interface OpenFileOptions {
  line?: number;
  column?: number;
}

const SQLITE_TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

function conversationTime(value: string | null | undefined): number {
  if (!value) return Number.NEGATIVE_INFINITY;
  const normalized = SQLITE_TIMESTAMP_RE.test(value) ? `${value.replace(' ', 'T')}Z` : value;
  const ts = Date.parse(normalized);
  return Number.isNaN(ts) ? Number.NEGATIVE_INFINITY : ts;
}

/** ActiveFile → serializable top-level diff tab target. */
function diffTabTarget(
  activeFile: ActiveFile,
  status?: GitChangeStatus
): Extract<TaskWindowTabTarget, { kind: 'diff' }> {
  return {
    kind: 'diff',
    path: activeFile.path,
    diffGroup: activeFile.group,
    originalRef: activeFile.originalRef,
    modifiedRef: activeFile.modifiedRef,
    prNumber: activeFile.prNumber,
    status,
  };
}

function compareConversationOpenPriority(a: ConversationStore, b: ConversationStore): number {
  const at = conversationTime(a.data.lastInteractedAt);
  const bt = conversationTime(b.data.lastInteractedAt);
  if (at !== bt) return bt - at;
  if (a.isInitialConversation !== b.isInitialConversation) {
    return a.isInitialConversation ? -1 : 1;
  }
  return a.data.id.localeCompare(b.data.id);
}

// ---------------------------------------------------------------------------
// TabManagerStore
// ---------------------------------------------------------------------------

/**
 * Owns all tab open/close/order/active state across conversation, file, and diff tabs.
 *
 * Entity-specific state lives in FileTabStore / DiffTabStore / ConversationTabEntry.
 * Monaco model registration is handled by FileModelLifecycleStore which watches this store.
 */
export class TabManagerStore implements Snapshottable<TabManagerSnapshot> {
  /** All open tab entries keyed by tabId. O(1) lookup; finer-grained MobX reactivity. */
  readonly entries = observable.map<string, TabEntry>();
  /** Tab display order (array of tabIds). Drives resolvedTabs. */
  tabOrder: string[] = [];
  activeTabId: string | undefined = undefined;
  isVisible = false;
  /**
   * Tabs pinned into the task sidebar strip (ordered). Entries stay in
   * `entries` but are removed from `tabOrder`, so a tab lives in exactly one
   * place at a time (move semantics — never duplicated across panes).
   */
  sidebarTabIds: string[] = [];
  /** The pinned sidebar tab currently selected in the sidebar strip, if any. */
  activeSidebarTabId: string | undefined = undefined;
  /**
   * Tabs pinned into the shell-level (cross-route) side pane. Same move
   * semantics as `sidebarTabIds`: entries stay in `entries` but live in
   * exactly one placement list at a time. Selection/order of the shell pane
   * itself lives in AppSidePaneStore — this list only marks ownership so the
   * model/PTY lifecycle (`_allTabIds`) keeps pinned entities alive.
   */
  shellPinTabIds: string[] = [];

  /** Used by resolvedTabs and FileModelLifecycleStore to build buffer URIs. */
  readonly modelRootPath: string;

  /**
   * Phase 2 top-level tab bridge, injected by the task view layer. When set,
   * open/activate intents are forwarded to the top-level app tab strip instead
   * of mutating internal order — the route replay then re-enters with
   * `applyingKey` set to the target identity and runs the internal logic.
   *
   * `applyingKey` (instead of a boolean) keeps rapid interactions correct: a
   * NEW target arriving while a replay is awaiting still forwards — only the
   * replay's own re-entry runs internally.
   */
  topLevelBridge: {
    applyingKey: string | null;
    open: (target: TaskWindowTabTarget) => void;
  } | null = null;

  private readonly conversations: ConversationManagerStore;
  private readonly disposers: (() => void)[] = [];
  private lastClosedConversationId: string | undefined = undefined;
  /** Reveal options stashed while an openFile intent round-trips the top level. */
  private readonly _pendingRevealByPath = new Map<string, OpenFileOptions>();
  /** Open intent recorded before the top-level bridge mounted. */
  private pendingTopLevelTarget: TaskWindowTabTarget | null = null;

  constructor(conversations: ConversationManagerStore, workspaceId: string) {
    this.conversations = conversations;
    this.modelRootPath = `workspace:${workspaceId}`;

    makeObservable(this, {
      tabOrder: observable,
      activeTabId: observable,
      isVisible: observable,
      sidebarTabIds: observable,
      activeSidebarTabId: observable,
      shellPinTabIds: observable,
      resolvedSidebarTabs: computed,
      activeSidebarConversation: computed,
      resolvedActiveTabId: computed,
      activeDescriptor: computed,
      activeConversation: computed,
      activeConversationId: computed,
      activeTopLevelTarget: computed,
      activeFileEntry: computed,
      activeFilePath: computed,
      activeDiffEntry: computed,
      previewFileEntry: computed,
      previewDiffEntry: computed,
      openFilePaths: computed,
      resolvedTabs: computed,
      snapshot: computed,
      openConversation: action,
      openConversationInSidebar: action,
      openConversationPreview: action,
      openFile: action,
      openFileInSidebar: action,
      openFileInShellPin: action,
      openFilePreview: action,
      openDiff: action,
      openDiffPreview: action,
      closeTab: action,
      closeActiveTab: action,
      closeOtherTabs: action,
      closeTabsToRight: action,
      closeAllTabs: action,
      openLastConversation: action,
      openPreferredConversation: action,
      setActiveTab: action,
      reorderTabs: action,
      setNextTabActive: action,
      setPreviousTabActive: action,
      setTabActiveIndex: action,
      moveTabToSidebar: action,
      moveSidebarTabBack: action,
      reorderSidebarTab: action,
      moveTabToShellPin: action,
      moveShellPinBack: action,
      setActiveSidebarTab: action,
      setVisible: action,
      updateRenderer: action,
      setImageContent: action,
      setFileTotalSize: action,
      transitionDiffTab: action,
      pinTab: action,
      restoreSnapshot: action,
      initializeDefault: action,
    });

    // Auto-close conversation tabs when the conversation is deleted from the manager.
    this.disposers.push(
      reaction(
        () => Array.from(conversations.conversations.keys()),
        action((ids: string[]) => {
          const idSet = new Set(ids);
          const toRemove: string[] = [];
          for (const [tabId, entry] of this.entries) {
            if (entry.kind === 'conversation' && !idSet.has(entry.conversationId)) {
              toRemove.push(tabId);
            }
          }
          for (const tabId of toRemove) {
            this._removeTab(tabId);
          }
        })
      )
    );

    // Mark conversation as seen when it becomes the active visible tab.
    this.disposers.push(
      autorun(() => {
        if (this.isVisible && this.activeConversation && !this.activeConversation.seen) {
          this.activeConversation.markSeen();
        }
      })
    );

    // The selected sidebar-pinned conversation is visible alongside the active tab.
    this.disposers.push(
      autorun(() => {
        if (
          this.isVisible &&
          this.activeSidebarConversation &&
          !this.activeSidebarConversation.seen
        ) {
          this.activeSidebarConversation.markSeen();
        }
      })
    );

    // Update telemetry scope when the active conversation changes.
    this.disposers.push(
      reaction(
        () => this.activeConversation?.data.id ?? null,
        (conversationId) => {
          if (this.isVisible) {
            setTelemetryConversationScope(conversationId);
          }
        }
      )
    );
  }

  // ---------------------------------------------------------------------------
  // Computed
  // ---------------------------------------------------------------------------

  /**
   * The effective active tab ID: the stored `activeTabId` when it points to an
   * existing entry, otherwise the first tab in order. This makes the invariant
   * "tabs exist → one is active" hold even when the stored value is stale or absent.
   */
  get resolvedActiveTabId(): string | undefined {
    if (
      this.activeTabId &&
      !this.sidebarTabIds.includes(this.activeTabId) &&
      !this.shellPinTabIds.includes(this.activeTabId) &&
      this.entries.has(this.activeTabId)
    ) {
      return this.activeTabId;
    }
    return this.tabOrder[0];
  }

  /** Sidebar-pinned tabs resolved for the sidebar strip, in pin order. */
  get resolvedSidebarTabs(): ResolvedTab[] {
    const result: ResolvedTab[] = [];
    for (const id of this.sidebarTabIds) {
      const entry = this.entries.get(id);
      if (!entry) continue;
      const resolved = this._resolveTab(entry, this.activeSidebarTabId === id);
      if (resolved) result.push(resolved);
    }
    return result;
  }

  get activeSidebarConversation(): ConversationStore | undefined {
    const entry = this.activeSidebarTabId ? this.entries.get(this.activeSidebarTabId) : undefined;
    if (entry?.kind !== 'conversation') return undefined;
    return this.conversations.conversations.get(entry.conversationId);
  }

  get activeDescriptor(): TabEntry | undefined {
    if (!this.resolvedActiveTabId) return undefined;
    return this.entries.get(this.resolvedActiveTabId);
  }

  get activeConversation(): ConversationStore | undefined {
    const desc = this.activeDescriptor;
    if (!desc || desc.kind !== 'conversation') return undefined;
    return this.conversations.conversations.get(desc.conversationId);
  }

  get activeConversationId(): string | undefined {
    const desc = this.activeDescriptor;
    return desc?.kind === 'conversation' ? desc.conversationId : undefined;
  }

  /**
   * The active entry expressed as a top-level tab target. Used by the view
   * layer to resolve a tab-less route (scope entry) to this task's own
   * last-active tab instead of forcing the overview.
   */
  get activeTopLevelTarget(): TaskWindowTabTarget | null {
    const desc = this.activeDescriptor;
    if (!desc || desc.kind === 'overview') return null;
    if (desc.kind === 'conversation') {
      return { kind: 'conversation', conversationId: desc.conversationId };
    }
    if (desc.kind === 'diff') {
      return {
        kind: 'diff',
        path: desc.path,
        diffGroup: desc.diffGroup,
        originalRef: desc.originalRef,
        modifiedRef: desc.modifiedRef,
        prNumber: desc.prNumber,
        status: desc.status,
      };
    }
    return { kind: 'file', path: desc.path };
  }

  get activeFileEntry(): FileTabStore | undefined {
    const desc = this.activeDescriptor;
    return desc?.kind === 'file' ? desc : undefined;
  }

  get activeFilePath(): string | null {
    return this.activeFileEntry?.path ?? null;
  }

  get activeDiffEntry(): DiffTabStore | undefined {
    const desc = this.activeDescriptor;
    return desc?.kind === 'diff' ? desc : undefined;
  }

  get previewFileEntry(): FileTabStore | undefined {
    for (const id of this.tabOrder) {
      const entry = this.entries.get(id);
      if (entry?.kind === 'file' && entry.isPreview) return entry;
    }
    return undefined;
  }

  get previewDiffEntry(): DiffTabStore | undefined {
    for (const id of this.tabOrder) {
      const entry = this.entries.get(id);
      if (entry?.kind === 'diff' && entry.isPreview) return entry;
    }
    return undefined;
  }

  /**
   * Paths of all currently open file tabs.
   * Used by FileModelLifecycleStore to drive Monaco model registration/unregistration.
   * Diff tabs are intentionally excluded — their model lifecycle is managed by
   * FileDiffView's own useEffect.
   */
  get openFilePaths(): string[] {
    const paths: string[] = [];
    for (const id of this._allTabIds()) {
      const entry = this.entries.get(id);
      if (entry?.kind === 'file') paths.push(entry.path);
    }
    return paths;
  }

  get resolvedTabs(): ResolvedTab[] {
    const result: ResolvedTab[] = [];
    const effectiveActiveId = this.resolvedActiveTabId;
    for (const id of this.tabOrder) {
      const entry = this.entries.get(id);
      if (!entry) continue;
      const resolved = this._resolveTab(entry, effectiveActiveId === entry.tabId);
      if (resolved) result.push(resolved);
    }
    return result;
  }

  get snapshot(): TabManagerSnapshot {
    const tabs: TabDescriptor[] = [];
    for (const id of this.tabOrder) {
      const entry = this.entries.get(id);
      if (!entry) continue;
      const descriptor = this._describeTab(entry);
      if (descriptor) tabs.push(descriptor);
    }
    const sidebarTabs: TabDescriptor[] = [];
    for (const id of this.sidebarTabIds) {
      const entry = this.entries.get(id);
      if (!entry) continue;
      const descriptor = this._describeTab(entry);
      if (descriptor) sidebarTabs.push(descriptor);
    }
    const shellPinTabs: TabDescriptor[] = [];
    for (const id of this.shellPinTabIds) {
      const entry = this.entries.get(id);
      if (!entry) continue;
      const descriptor = this._describeTab(entry);
      if (descriptor) shellPinTabs.push(descriptor);
    }
    return {
      tabs,
      activeTabId: this.activeTabId,
      sidebarTabs,
      activeSidebarTabId: this.activeSidebarTabId,
      shellPinTabs,
    };
  }

  // ---------------------------------------------------------------------------
  // Actions — opening conversation tabs
  // ---------------------------------------------------------------------------

  /**
   * Forwards an open/activate intent to the top-level tab strip when the
   * bridge is wired and this task is the active view. Returns true when
   * forwarded (callers should bail); the top-level route replay re-enters
   * with `applying` set and runs the internal logic.
   *
   * Intents that arrive before the bridge mounts (e.g. initializeDefault
   * opening the initial conversation during provisioning) are remembered and
   * flushed by the view layer once the bridge is injected — so a fresh task
   * lands on its session tab, not the overview.
   */
  private _forwardToTopLevel(target: TaskWindowTabTarget): boolean {
    const bridge = this.topLevelBridge;
    if (!bridge) {
      log.debug('[tab-sync] forward: no bridge yet, stashing intent', target);
      this.pendingTopLevelTarget = target;
      return false;
    }
    if (!this.isVisible) {
      log.debug('[tab-sync] forward: not visible, running internally', target);
      return false;
    }
    // Replay re-entry for the same target runs internally; anything else is a
    // fresh user intent and surfaces as a top-level tab.
    if (bridge.applyingKey === JSON.stringify(target)) {
      log.debug('[tab-sync] forward: replay re-entry, running internally', target);
      return false;
    }
    log.debug('[tab-sync] forward: surfacing as top-level tab', target);
    bridge.open(target);
    return true;
  }

  /** Returns (and clears) an open intent that predates the bridge injection. */
  flushPendingTopLevelTarget(): TaskWindowTabTarget | null {
    const target = this.pendingTopLevelTarget;
    this.pendingTopLevelTarget = null;
    return target;
  }

  openConversation(conversationId: string): void {
    if (this._forwardToTopLevel({ kind: 'conversation', conversationId })) return;
    const existing = this._findConversationEntry(conversationId);
    if (existing) {
      existing.isPreview = false;
      this._activateExisting(existing.tabId);
      return;
    }
    const entry = new ConversationTabEntry(conversationId, false);
    this.entries.set(entry.tabId, entry);
    addTabId(this, entry.tabId);
    this.activeTabId = entry.tabId;
  }

  /**
   * Open a conversation directly as a sidebar-pinned tab so it shows alongside
   * the main area (review mode pins the reviewer beside the implementer). An
   * entry already open in the main strip is moved aside; never forwarded to the
   * top level — the whole point is the side-by-side layout inside this task.
   */
  openConversationInSidebar(conversationId: string): void {
    const existing = this._findConversationEntry(conversationId);
    if (existing) {
      existing.isPreview = false;
      if (this.sidebarTabIds.includes(existing.tabId)) {
        this.activeSidebarTabId = existing.tabId;
      } else {
        this.moveTabToSidebar(existing.tabId);
      }
      return;
    }
    const entry = new ConversationTabEntry(conversationId, false);
    this.entries.set(entry.tabId, entry);
    this.sidebarTabIds.push(entry.tabId);
    this.activeSidebarTabId = entry.tabId;
  }

  openConversationPreview(conversationId: string): void {
    // Top level has no preview semantics yet (Phase 2b) — open as a full tab.
    if (this._forwardToTopLevel({ kind: 'conversation', conversationId })) return;
    const existing = this._findConversationEntry(conversationId);
    if (existing) {
      // Already open (stable or preview) — just activate; never demote stable → preview.
      this._activateExisting(existing.tabId);
      return;
    }
    const previewEntry = this._findConversationPreviewEntry();
    if (previewEntry) {
      // Replace in-place: mutate conversationId so the same tabId and slot are reused.
      previewEntry.conversationId = conversationId;
      this.activeTabId = previewEntry.tabId;
      return;
    }
    const entry = new ConversationTabEntry(conversationId, true);
    this.entries.set(entry.tabId, entry);
    addTabId(this, entry.tabId);
    this.activeTabId = entry.tabId;
  }

  // ---------------------------------------------------------------------------
  // Actions — opening file tabs
  // ---------------------------------------------------------------------------

  openFile(path: string, options?: OpenFileOptions): void {
    if (this._forwardToTopLevel({ kind: 'file', path })) {
      // Reveal targets are not part of the route — stash them for the replay.
      if (options) this._pendingRevealByPath.set(path, options);
      return;
    }
    const pendingReveal = this._pendingRevealByPath.get(path);
    this._pendingRevealByPath.delete(path);
    const reveal = options ?? pendingReveal;

    const existing = this._findFileEntryByPath(path);
    if (existing) {
      existing.isPreview = false;
      existing.revealLocation(reveal?.line, reveal?.column);
      this._activateExisting(existing.tabId);
      return;
    }
    const tab = new FileTabStore(path, false);
    tab.revealLocation(reveal?.line, reveal?.column);
    this.entries.set(tab.tabId, tab);
    addTabId(this, tab.tabId);
    this.activeTabId = tab.tabId;
  }

  /**
   * Open a file directly as a sidebar-pinned tab (terminal/conversation smart
   * path links land here so the session stays visible). An entry already open
   * in the main strip is moved aside; never forwarded to the top level —
   * the whole point is staying in this task view.
   */
  openFileInSidebar(path: string, options?: OpenFileOptions): void {
    const existing = this._findFileEntryByPath(path);
    if (existing) {
      existing.isPreview = false;
      existing.revealLocation(options?.line, options?.column);
      if (this.sidebarTabIds.includes(existing.tabId)) {
        this.activeSidebarTabId = existing.tabId;
      } else {
        this.moveTabToSidebar(existing.tabId);
      }
      return;
    }
    const tab = new FileTabStore(path, false);
    tab.revealLocation(options?.line, options?.column);
    this.entries.set(tab.tabId, tab);
    this.sidebarTabIds.push(tab.tabId);
    this.activeSidebarTabId = tab.tabId;
  }

  /**
   * Open a file directly as a shell-pane pinned tab (cross-route). Returns the
   * tab id so the caller can register the matching pin in AppSidePaneStore —
   * the pane's own selection/order lives there, never in this store.
   */
  openFileInShellPin(path: string, options?: OpenFileOptions): string {
    const existing = this._findFileEntryByPath(path);
    if (existing) {
      existing.isPreview = false;
      existing.revealLocation(options?.line, options?.column);
      this.moveTabToShellPin(existing.tabId);
      return existing.tabId;
    }
    const tab = new FileTabStore(path, false);
    tab.revealLocation(options?.line, options?.column);
    this.entries.set(tab.tabId, tab);
    this.shellPinTabIds.push(tab.tabId);
    return tab.tabId;
  }

  openFilePreview(path: string): void {
    // Top level has no preview semantics yet (Phase 2b) — open as a full tab.
    if (this._forwardToTopLevel({ kind: 'file', path })) return;
    const existing = this._findFileEntryByPath(path);
    if (existing) {
      this._activateExisting(existing.tabId);
      return;
    }

    const prevPreview = this.previewFileEntry;
    const prevUri = prevPreview ? buildMonacoModelPath(this.modelRootPath, prevPreview.path) : null;
    const canReplace = prevPreview && prevUri && !modelRegistry.isDirty(prevUri);

    if (canReplace && prevPreview) {
      // Mutate in place — tabId unchanged, React sees one render with new content.
      prevPreview.resetForPath(path);
      this.activeTabId = prevPreview.tabId;
      return;
    }

    // No clean preview to reuse. Promote any dirty preview to stable, then add new preview.
    if (prevPreview) prevPreview.isPreview = false;

    const tab = new FileTabStore(path, true);
    this.entries.set(tab.tabId, tab);
    addTabId(this, tab.tabId);
    this.activeTabId = tab.tabId;
  }

  // ---------------------------------------------------------------------------
  // Actions — opening diff tabs
  // ---------------------------------------------------------------------------

  openDiff(activeFile: ActiveFile, status?: GitChangeStatus): void {
    if (this._forwardToTopLevel(diffTabTarget(activeFile, status))) return;
    const existing = this._findDiffEntryByKey(activeFile.path, activeFile.group);
    if (existing) {
      existing.isPreview = false;
      if (status !== undefined) existing.status = status;
      this._activateExisting(existing.tabId);
      return;
    }
    const tab = new DiffTabStore(activeFile, false, undefined, status);
    this.entries.set(tab.tabId, tab);
    addTabId(this, tab.tabId);
    this.activeTabId = tab.tabId;
  }

  openDiffPreview(activeFile: ActiveFile, status?: GitChangeStatus): void {
    // Top level has no preview semantics yet (Phase 2b) — open as a full tab.
    if (this._forwardToTopLevel(diffTabTarget(activeFile, status))) return;
    const existing = this._findDiffEntryByKey(activeFile.path, activeFile.group);
    if (existing) {
      this._activateExisting(existing.tabId);
      return;
    }

    const previewEntry = this.previewDiffEntry;
    if (previewEntry) {
      // Replace preview in-place: remove old, insert new at same position.
      const idx = this.tabOrder.indexOf(previewEntry.tabId);
      this.entries.delete(previewEntry.tabId);
      const tab = new DiffTabStore(activeFile, true, undefined, status);
      this.entries.set(tab.tabId, tab);
      this.tabOrder.splice(idx, 1, tab.tabId);
      this.activeTabId = tab.tabId;
      return;
    }

    const tab = new DiffTabStore(activeFile, true, undefined, status);
    this.entries.set(tab.tabId, tab);
    addTabId(this, tab.tabId);
    this.activeTabId = tab.tabId;
  }

  // ---------------------------------------------------------------------------
  // Actions — renderer/diff state (delegation proxies)
  // ---------------------------------------------------------------------------

  /** Delegation proxy — callers with the path can still call this. */
  updateRenderer(filePath: string, updater: (prev: FileRendererData) => FileRendererData): void {
    const entry = this._findFileEntryByPath(filePath);
    if (entry) entry.updateRenderer(updater);
  }

  /**
   * Called by the model-lifecycle reaction in TaskViewStore after an image is fetched.
   * Delegation proxy — will be removed when FileModelLifecycleStore is extracted.
   */
  setImageContent(path: string, content: string): void {
    const entry = this._findFileEntryByPath(path);
    if (entry) entry.setImageContent(content);
  }

  /**
   * Called by the model-lifecycle reaction in TaskViewStore after a too-large file is detected.
   * Delegation proxy — will be removed when FileModelLifecycleStore is extracted.
   */
  setFileTotalSize(path: string, totalSize: number): void {
    const entry = this._findFileEntryByPath(path);
    if (entry) entry.setTotalSize(totalSize);
  }

  /**
   * Transitions a diff tab between disk/staged groups in-place.
   * Delegation proxy — will be removed when DiffTabLifecycleStore is extracted.
   */
  transitionDiffTab(
    tabId: string,
    newGroup: 'disk' | 'staged',
    newOriginalRef: GitObjectRef,
    status?: GitChangeStatus
  ): void {
    const entry = this.entries.get(tabId);
    if (entry?.kind === 'diff') entry.transition(newGroup, newOriginalRef, status);
  }

  // ---------------------------------------------------------------------------
  // Actions — closing / navigation
  // ---------------------------------------------------------------------------

  closeTab(id: string): void {
    // The overview tab is fixed and cannot be closed.
    if (this.entries.get(id)?.kind === 'overview') return;
    this._removeTab(id);
  }

  closeActiveTab(): void {
    if (!this.activeTabId) return;
    this.closeTab(this.activeTabId);
  }

  /** Close every closeable tab except the given one (and the fixed overview tab). */
  closeOtherTabs(keepId: string): void {
    for (const id of [...this.tabOrder]) {
      if (id !== keepId) this.closeTab(id);
    }
  }

  /** Close every closeable tab positioned after the given one in display order. */
  closeTabsToRight(fromId: string): void {
    const fromIndex = this.tabOrder.indexOf(fromId);
    if (fromIndex === -1) return;
    for (const id of this.tabOrder.slice(fromIndex + 1)) {
      this.closeTab(id);
    }
  }

  /** Close every closeable tab (the fixed overview tab always remains). */
  closeAllTabs(): void {
    for (const id of [...this.tabOrder]) {
      this.closeTab(id);
    }
  }

  setActiveTab(id: string): void {
    // Overview activation surfaces as a top-level tab; other ids are internal
    // mechanics (close-reassign, restore) and stay below the bridge.
    if (id === OVERVIEW_TAB_ID && this._forwardToTopLevel({ kind: 'overview' })) return;
    this.activeTabId = id;
    const entry = this.activeDescriptor;
    if (entry?.kind === 'conversation' && this.isVisible) {
      setTelemetryConversationScope(entry.conversationId);
    }
  }

  reorderTabs(fromIndex: number, toIndex: number): void {
    // The overview tab is fixed at index 0: never move it, and never let another
    // tab take its slot.
    if (this.entries.get(this.tabOrder[fromIndex] ?? '')?.kind === 'overview') return;
    const hasOverview = this.entries.get(this.tabOrder[0] ?? '')?.kind === 'overview';
    const clampedTo = hasOverview ? Math.max(1, toIndex) : toIndex;
    reorderTabIds(this, fromIndex, clampedTo);
  }

  setNextTabActive(): void {
    tabUtilsSetNextTabActive(this);
  }

  setPreviousTabActive(): void {
    tabUtilsSetPreviousTabActive(this);
  }

  setTabActiveIndex(index: number): void {
    tabUtilsSetTabActiveIndex(this, index);
  }

  pinTab(tabId: string): void {
    const entry = this.entries.get(tabId);
    if (entry && entry.kind !== 'overview') entry.isPreview = false;
  }

  // ---------------------------------------------------------------------------
  // Actions — sidebar-pinned tabs
  // ---------------------------------------------------------------------------

  /**
   * Move a tab from the strip into the sidebar strip (appended) and select it
   * there. Pinned tabs accumulate — closing one returns it to the strip.
   */
  moveTabToSidebar(tabId: string): void {
    const entry = this.entries.get(tabId);
    if (!entry || entry.kind === 'overview' || this.sidebarTabIds.includes(tabId)) return;
    // Pinning aside is a deliberate act — never keep preview semantics.
    entry.isPreview = false;
    removeTabId(this, tabId);
    this.sidebarTabIds.push(tabId);
    this.activeSidebarTabId = tabId;
    // The entity changes HOST (main area → sidebar) without its new container
    // resizing, so mounted terminals must re-measure explicitly.
    scheduleTerminalRelayout();
  }

  /**
   * Move a sidebar-pinned tab back to the end of the strip, without activating
   * it — closing a pin shouldn't yank the main area away from its current tab.
   */
  moveSidebarTabBack(tabId: string): void {
    if (!this._unpinSidebarTab(tabId)) return;
    if (!this.entries.has(tabId)) return;
    addTabId(this, tabId);
  }

  /**
   * Reorder a sidebar-pinned chip to a raw insertion index (computed before
   * removal, as drop zones do).
   */
  reorderSidebarTab(tabId: string, toIndex: number): void {
    const from = this.sidebarTabIds.indexOf(tabId);
    if (from === -1) return;
    const insert = Math.max(
      0,
      Math.min(toIndex > from ? toIndex - 1 : toIndex, this.sidebarTabIds.length - 1)
    );
    if (insert === from) return;
    this.sidebarTabIds.splice(from, 1);
    this.sidebarTabIds.splice(insert, 0, tabId);
  }

  /** Select a pinned tab in the sidebar strip; undefined yields to the builtin panels. */
  setActiveSidebarTab(tabId: string | undefined): void {
    this.activeSidebarTabId = tabId && this.sidebarTabIds.includes(tabId) ? tabId : undefined;
  }

  // ---------------------------------------------------------------------------
  // Actions — shell-pane pinned tabs (cross-route)
  // ---------------------------------------------------------------------------

  /**
   * Move a tab out of the strip into the shell-level side pane. The overview
   * tab is fixed and shell pins of it use copy semantics at the call site —
   * it never enters this list.
   */
  moveTabToShellPin(tabId: string): void {
    const entry = this.entries.get(tabId);
    if (!entry || entry.kind === 'overview' || this.shellPinTabIds.includes(tabId)) return;
    // Pinning aside is a deliberate act — never keep preview semantics.
    entry.isPreview = false;
    removeTabId(this, tabId);
    this._unpinSidebarTab(tabId);
    this.shellPinTabIds.push(tabId);
    // The entity changes HOST without its new container resizing, so mounted
    // terminals must re-measure explicitly.
    scheduleTerminalRelayout();
  }

  /**
   * Move a shell-pane pin back to the end of the strip without activating it —
   * closing a pin shouldn't yank the main area away from its current tab.
   */
  moveShellPinBack(tabId: string): void {
    if (!this._unpinShellTab(tabId)) return;
    if (!this.entries.has(tabId)) return;
    addTabId(this, tabId);
  }

  /** Resolve a single entry for hosts outside the strip (shell pane chips/bodies). */
  resolveTab(tabId: string): ResolvedTab | undefined {
    const entry = this.entries.get(tabId);
    if (!entry) return undefined;
    return this._resolveTab(entry, false);
  }

  /** Remove a tab from the shell-pin list. Returns true when it was pinned there. */
  private _unpinShellTab(tabId: string): boolean {
    const idx = this.shellPinTabIds.indexOf(tabId);
    if (idx === -1) return false;
    this.shellPinTabIds.splice(idx, 1);
    // The entity returns to a container whose size didn't change — re-measure.
    scheduleTerminalRelayout();
    return true;
  }

  /** Remove a tab from the pinned list, fixing selection. Returns true when it was pinned. */
  private _unpinSidebarTab(tabId: string): boolean {
    const idx = this.sidebarTabIds.indexOf(tabId);
    if (idx === -1) return false;
    this.sidebarTabIds.splice(idx, 1);
    if (this.activeSidebarTabId === tabId) {
      // Fall to the neighboring pin so the sidebar doesn't snap back to a
      // builtin panel while other pins remain.
      this.activeSidebarTabId = this.sidebarTabIds[idx] ?? this.sidebarTabIds[idx - 1];
    }
    // Covers every unpin path (close chip, reclaim-on-activate, tab removal):
    // the entity returns to the main area whose container size didn't change,
    // so mounted terminals must re-measure explicitly.
    scheduleTerminalRelayout();
    return true;
  }

  // ---------------------------------------------------------------------------
  // Visibility / telemetry
  // ---------------------------------------------------------------------------

  setVisible(visible: boolean): void {
    this.isVisible = visible;
    if (visible) {
      setTelemetryConversationScope(this.activeConversation?.data.id ?? null);
    }
  }

  // ---------------------------------------------------------------------------
  // Helpers for sidebar
  // ---------------------------------------------------------------------------

  hasConversationTab(conversationId: string): boolean {
    return this._findConversationEntry(conversationId) !== undefined;
  }

  /**
   * Reopen the most recently closed conversation when possible; otherwise open
   * the most recently interacted conversation for this task.
   */
  openLastConversation(): boolean {
    const conversationId = this._conversationIdToOpen();
    if (!conversationId) return false;
    this.openConversation(conversationId);
    return true;
  }

  /**
   * Open the task's preferred conversation by activity. This intentionally ignores
   * `lastClosedConversationId`, which is useful for explicit "return to task"
   * navigation where a stale closed tab should not override the latest session.
   */
  openPreferredConversation(): boolean {
    const conversationId = this._preferredConversationId();
    if (!conversationId) return false;
    this.openConversation(conversationId);
    return true;
  }

  // ---------------------------------------------------------------------------
  // Snapshot
  // ---------------------------------------------------------------------------

  restoreSnapshot(snapshot: Partial<TabManagerSnapshot>): void {
    if (snapshot.tabs) {
      this.entries.clear();
      this.tabOrder = [];
      this.sidebarTabIds = [];
      this.activeSidebarTabId = undefined;
      this.shellPinTabIds = [];
      for (const t of snapshot.tabs) {
        const entry = this._entryFromDescriptor(t);
        if (!entry) continue;
        this.entries.set(entry.tabId, entry);
        this.tabOrder.push(entry.tabId);
      }
      // Legacy single side-pane slot migrates into the pinned list.
      const pinned = snapshot.sidebarTabs ?? (snapshot.sidePaneTab ? [snapshot.sidePaneTab] : []);
      for (const t of pinned) {
        const entry = this._entryFromDescriptor(t);
        if (!entry) continue;
        this.entries.set(entry.tabId, entry);
        this.sidebarTabIds.push(entry.tabId);
      }
      for (const t of snapshot.shellPinTabs ?? []) {
        const entry = this._entryFromDescriptor(t);
        if (!entry) continue;
        this.entries.set(entry.tabId, entry);
        this.shellPinTabIds.push(entry.tabId);
      }
      if (snapshot.activeSidebarTabId && this.sidebarTabIds.includes(snapshot.activeSidebarTabId)) {
        this.activeSidebarTabId = snapshot.activeSidebarTabId;
      }
    }
    this._ensureOverviewTab();
    if (snapshot.activeTabId !== undefined) this.activeTabId = snapshot.activeTabId;
  }

  initializeDefault(): void {
    this._ensureOverviewTab();
    for (const [id, store] of this.conversations.conversations) {
      if (store.isInitialConversation) {
        this.openConversation(id);
        return;
      }
    }
  }

  /**
   * Inject the fixed overview tab at the first position if missing. Called after
   * snapshot restore (overview is never persisted) and during default init.
   * Active-tab selection is left untouched so the conversation stays focused.
   */
  private _ensureOverviewTab(): void {
    if (this.entries.has(OVERVIEW_TAB_ID)) return;
    const entry = new OverviewTabEntry();
    this.entries.set(entry.tabId, entry);
    this.tabOrder.unshift(entry.tabId);
  }

  dispose(): void {
    for (const d of this.disposers) d();
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /** All tab ids that hold a live entry: the strip order plus both pin lists. */
  private *_allTabIds(): Iterable<string> {
    yield* this.tabOrder;
    yield* this.sidebarTabIds;
    yield* this.shellPinTabIds;
  }

  /**
   * Activate an already-open tab found by an open* dedupe lookup. Activating a
   * sidebar-pinned tab (list click / top-level route replay) means "show it in
   * the MAIN area" — reclaim it, otherwise resolvedActiveTabId skips it and
   * silently falls back to the overview while every upstream step looks
   * successful.
   */
  private _activateExisting(tabId: string): void {
    if (this._unpinSidebarTab(tabId) || this._unpinShellTab(tabId)) {
      addTabId(this, tabId);
    }
    this.activeTabId = tabId;
  }

  private _resolveTab(entry: TabEntry, isActive: boolean): ResolvedTab | undefined {
    if (entry.kind === 'overview') {
      return { kind: 'overview', tabId: entry.tabId, isPreview: false, isActive };
    }
    if (entry.kind === 'conversation') {
      const store = this.conversations.conversations.get(entry.conversationId);
      if (!store) return undefined;
      return {
        kind: 'conversation',
        tabId: entry.tabId,
        conversationId: entry.conversationId,
        store,
        isPreview: entry.isPreview,
        isActive,
      };
    }
    if (entry.kind === 'diff') {
      return {
        kind: 'diff',
        tabId: entry.tabId,
        path: entry.path,
        diffGroup: entry.diffGroup,
        originalRef: entry.originalRef,
        modifiedRef: entry.modifiedRef,
        prNumber: entry.prNumber,
        status: entry.status,
        isPreview: entry.isPreview,
        isActive,
      };
    }
    const bufferUri = buildMonacoModelPath(this.modelRootPath, entry.path);
    return {
      kind: 'file',
      tabId: entry.tabId,
      path: entry.path,
      isPreview: entry.isPreview,
      isDirty: modelRegistry.dirtyUris.has(bufferUri),
      bufferUri,
      isActive,
    };
  }

  /** Serialize an entry to its persisted descriptor. Overview is never persisted. */
  private _describeTab(entry: TabEntry): TabDescriptor | undefined {
    if (entry.kind === 'overview') return undefined;
    if (entry.kind === 'conversation') {
      return {
        kind: 'conversation',
        tabId: entry.tabId,
        conversationId: entry.conversationId,
        isPreview: entry.isPreview,
      };
    }
    if (entry.kind === 'diff') {
      return {
        kind: 'diff',
        tabId: entry.tabId,
        path: entry.path,
        diffGroup: entry.diffGroup,
        originalRef: entry.originalRef,
        modifiedRef: entry.modifiedRef,
        prNumber: entry.prNumber,
        status: entry.status,
        isPreview: entry.isPreview,
      };
    }
    return { kind: 'file', tabId: entry.tabId, path: entry.path, isPreview: entry.isPreview };
  }

  private _entryFromDescriptor(t: TabDescriptor): TabEntry | null {
    // Tolerate stale descriptors from retired tab kinds (e.g. the short-lived
    // pinned 'browser' tabs) — skip instead of mis-restoring as a file tab.
    if (t.kind !== 'conversation' && t.kind !== 'diff' && t.kind !== 'file') return null;
    if (t.kind === 'conversation') {
      return new ConversationTabEntry(t.conversationId, t.isPreview, t.tabId);
    }
    if (t.kind === 'diff') {
      return new DiffTabStore(
        {
          path: t.path,
          type: t.diffGroup === 'disk' ? 'disk' : 'git',
          group: t.diffGroup,
          originalRef: t.originalRef,
          modifiedRef: t.modifiedRef,
          prNumber: t.prNumber,
        },
        t.isPreview,
        t.tabId,
        t.status
      );
    }
    return new FileTabStore(t.path, t.isPreview, t.tabId);
  }

  private _findConversationEntry(conversationId: string): ConversationTabEntry | undefined {
    for (const id of this._allTabIds()) {
      const entry = this.entries.get(id);
      if (entry?.kind === 'conversation' && entry.conversationId === conversationId) {
        return entry;
      }
    }
    return undefined;
  }

  private _findConversationPreviewEntry(): ConversationTabEntry | undefined {
    for (const id of this.tabOrder) {
      const entry = this.entries.get(id);
      if (entry?.kind === 'conversation' && entry.isPreview) return entry;
    }
    return undefined;
  }

  private _findFileEntryByPath(path: string): FileTabStore | undefined {
    for (const id of this._allTabIds()) {
      const entry = this.entries.get(id);
      if (entry?.kind === 'file' && entry.path === path) return entry;
    }
    return undefined;
  }

  private _findDiffEntryByKey(path: string, group: string): DiffTabStore | undefined {
    for (const id of this._allTabIds()) {
      const entry = this.entries.get(id);
      if (entry?.kind === 'diff' && entry.path === path && entry.diffGroup === group) return entry;
    }
    return undefined;
  }

  private _conversationIdToOpen(): string | undefined {
    if (
      this.lastClosedConversationId &&
      this.conversations.conversations.has(this.lastClosedConversationId)
    ) {
      return this.lastClosedConversationId;
    }

    return this._preferredConversationId();
  }

  private _preferredConversationId(): string | undefined {
    let best: ConversationStore | undefined;
    for (const conversation of this.conversations.conversations.values()) {
      if (!best || compareConversationOpenPriority(conversation, best) < 0) {
        best = conversation;
      }
    }
    return best?.data.id;
  }

  private _removeTab(id: string): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    if (entry.kind === 'conversation') {
      this.lastClosedConversationId = entry.conversationId;
    }
    this._unpinSidebarTab(id);
    this._unpinShellTab(id);
    this.entries.delete(id);
    removeTabId(this, id);
  }
}
