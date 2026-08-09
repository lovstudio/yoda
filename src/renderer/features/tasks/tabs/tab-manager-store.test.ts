import { observable } from 'mobx';
import { describe, expect, it, vi } from 'vitest';
import type { Conversation } from '@shared/conversations';
import type { ConversationManagerStore } from '@renderer/features/tasks/conversations/conversation-manager';
import { OVERVIEW_TAB_ID, TabManagerStore } from './tab-manager-store';

vi.mock('@renderer/lib/ipc', () => ({
  events: {
    on: vi.fn(() => () => {}),
  },
  rpc: {},
}));

describe('TabManagerStore conversation recovery', () => {
  it('reopens the most recently closed conversation', () => {
    const store = new TabManagerStore(
      makeConversationManager([
        makeConversation('conversation-1', '2026-05-01T00:00:00.000Z', true),
        makeConversation('conversation-2', '2026-05-02T00:00:00.000Z', false),
      ]),
      'workspace-1'
    );

    store.openConversation('conversation-1');
    const tabId = store.resolvedActiveTabId;
    if (!tabId) throw new Error('Expected an active tab');

    store.closeTab(tabId);
    expect(store.resolvedTabs).toHaveLength(0);

    expect(store.openLastConversation()).toBe(true);
    expect(store.activeConversationId).toBe('conversation-1');
  });

  it('falls back to the most recently interacted conversation', () => {
    const store = new TabManagerStore(
      makeConversationManager([
        makeConversation('conversation-1', '2026-05-01T00:00:00.000Z', true),
        makeConversation('conversation-2', '2026-05-02T00:00:00.000Z', false),
      ]),
      'workspace-1'
    );

    expect(store.openLastConversation()).toBe(true);
    expect(store.activeConversationId).toBe('conversation-2');
  });

  it('opens the preferred conversation without reusing a stale closed tab', () => {
    const store = new TabManagerStore(
      makeConversationManager([
        makeConversation('conversation-1', '2026-05-01T00:00:00.000Z', true),
        makeConversation('conversation-2', '2026-05-02T00:00:00.000Z', false),
      ]),
      'workspace-1'
    );

    store.openConversation('conversation-1');
    const tabId = store.resolvedActiveTabId;
    if (!tabId) throw new Error('Expected an active tab');
    store.closeTab(tabId);

    expect(store.openPreferredConversation()).toBe(true);
    expect(store.activeConversationId).toBe('conversation-2');
  });
});

describe('TabManagerStore overview tab', () => {
  it('injects a fixed overview tab at index 0 on default init, keeping the conversation active', () => {
    const store = new TabManagerStore(
      makeConversationManager([
        makeConversation('conversation-1', '2026-05-01T00:00:00.000Z', true),
      ]),
      'workspace-1'
    );

    store.initializeDefault();

    expect(store.resolvedTabs[0]?.kind).toBe('overview');
    expect(store.tabOrder[0]).toBe(OVERVIEW_TAB_ID);
    // Default focus stays on the conversation, not the overview tab.
    expect(store.activeConversationId).toBe('conversation-1');
  });

  it('resolves a conversation target even when Overview is the only open tab', () => {
    const store = new TabManagerStore(
      makeConversationManager([
        makeConversation('conversation-1', '2026-05-01T00:00:00.000Z', true),
      ]),
      'workspace-1'
    );

    store.initializeDefault();
    const conversationTabId = store.resolvedTabs.find((tab) => tab.kind === 'conversation')?.tabId;
    if (!conversationTabId) throw new Error('Expected a conversation tab');
    store.closeTab(conversationTabId);

    expect(store.resolvedTabs.map((tab) => tab.kind)).toEqual(['overview']);
    expect(store.preferredConversationTarget).toEqual({
      kind: 'conversation',
      conversationId: 'conversation-1',
    });
  });

  it('cannot be closed', () => {
    const store = new TabManagerStore(makeConversationManager([]), 'workspace-1');
    store.initializeDefault();

    store.closeTab(OVERVIEW_TAB_ID);

    expect(store.tabOrder).toContain(OVERVIEW_TAB_ID);
  });

  it('is excluded from the persisted snapshot', () => {
    const store = new TabManagerStore(
      makeConversationManager([
        makeConversation('conversation-1', '2026-05-01T00:00:00.000Z', true),
      ]),
      'workspace-1'
    );
    store.initializeDefault();

    // The overview tab is synthesized per-mount and never serialized.
    expect(store.snapshot.tabs).toHaveLength(1);
    expect(store.snapshot.tabs.every((t) => t.kind === 'conversation')).toBe(true);
  });

  it('is re-injected after restoring a snapshot that never contained it', () => {
    const store = new TabManagerStore(
      makeConversationManager([
        makeConversation('conversation-1', '2026-05-01T00:00:00.000Z', true),
      ]),
      'workspace-1'
    );

    store.restoreSnapshot({
      tabs: [
        {
          kind: 'conversation',
          tabId: 'tab-1',
          conversationId: 'conversation-1',
          isPreview: false,
        },
      ],
      activeTabId: 'tab-1',
    });

    expect(store.tabOrder[0]).toBe(OVERVIEW_TAB_ID);
    expect(store.activeTabId).toBe('tab-1');
  });

  it('stays pinned at index 0 when other tabs are reordered', () => {
    const store = new TabManagerStore(
      makeConversationManager([
        makeConversation('conversation-1', '2026-05-01T00:00:00.000Z', true),
        makeConversation('conversation-2', '2026-05-02T00:00:00.000Z', false),
      ]),
      'workspace-1'
    );
    store.initializeDefault();
    store.openConversation('conversation-2');

    // Attempt to drag a conversation (index 1) into the overview slot (index 0).
    store.reorderTabs(1, 0);

    expect(store.tabOrder[0]).toBe(OVERVIEW_TAB_ID);
  });
});

describe('TabManagerStore top-level replay bridge', () => {
  it('consumes a pre-bridge initial target only once', () => {
    const store = new TabManagerStore(
      makeConversationManager([
        makeConversation('conversation-1', '2026-05-01T00:00:00.000Z', true),
      ]),
      'workspace-1'
    );

    store.initializeDefault();

    expect(store.flushPendingTopLevelTarget()).toEqual({
      kind: 'conversation',
      conversationId: 'conversation-1',
    });
    expect(store.flushPendingTopLevelTarget()).toBeNull();
  });

  it('matches a replay by key without letting a different target bypass the bridge', () => {
    const store = new TabManagerStore(
      makeConversationManager([
        makeConversation('conversation-1', '2026-05-01T00:00:00.000Z', true),
        makeConversation('conversation-2', '2026-05-02T00:00:00.000Z', false),
      ]),
      'workspace-1'
    );
    const open = vi.fn();
    store.setVisible(true);
    store.topLevelBridge = {
      applying: {
        key: JSON.stringify({ kind: 'conversation', conversationId: 'conversation-1' }),
        token: Symbol('replay-1'),
      },
      open,
    };

    store.openConversation('conversation-1');
    store.openConversation('conversation-2');

    expect(store.activeConversationId).toBe('conversation-1');
    expect(open).toHaveBeenCalledOnce();
    expect(open).toHaveBeenCalledWith({
      kind: 'conversation',
      conversationId: 'conversation-2',
    });
  });
});

describe('TabManagerStore sidebar file locations', () => {
  it('keeps the requested line and column on the pinned file entry', () => {
    const store = new TabManagerStore(makeConversationManager([]), 'workspace-1');

    store.openFileInSidebar('src/main.ts', { line: 31, column: 4 });

    const entry = store.activeSidebarTabId
      ? store.entries.get(store.activeSidebarTabId)
      : undefined;
    expect(entry?.kind).toBe('file');
    if (entry?.kind !== 'file') throw new Error('Expected a sidebar file entry');
    expect(entry.pendingReveal).toEqual({ requestId: 1, lineNumber: 31, column: 4 });
  });

  it('reuses one clean sidebar preview while inspecting files', () => {
    const store = new TabManagerStore(makeConversationManager([]), 'workspace-1');

    store.openFilePreviewInSidebar('docs/brief.pdf');
    const previewId = store.activeSidebarTabId;
    expect(previewId).toBeDefined();
    expect(store.sidebarTabIds).toEqual([previewId]);

    store.openFilePreviewInSidebar('assets/mockup.png');

    expect(store.sidebarTabIds).toEqual([previewId]);
    const entry = previewId ? store.entries.get(previewId) : undefined;
    expect(entry?.kind).toBe('file');
    if (entry?.kind !== 'file') throw new Error('Expected a sidebar file preview');
    expect(entry.path).toBe('assets/mockup.png');
    expect(entry.isPreview).toBe(true);
  });

  it('promotes a sidebar preview when the file is opened in the main area', () => {
    const store = new TabManagerStore(makeConversationManager([]), 'workspace-1');

    store.openFilePreviewInSidebar('docs/brief.pdf');
    const previewId = store.activeSidebarTabId;
    store.openFile('docs/brief.pdf');

    expect(store.sidebarTabIds).not.toContain(previewId);
    expect(store.activeTabId).toBe(previewId);
    const entry = previewId ? store.entries.get(previewId) : undefined;
    expect(entry?.kind).toBe('file');
    if (entry?.kind !== 'file') throw new Error('Expected an opened file');
    expect(entry.isPreview).toBe(false);
  });
});

function makeConversation(id: string, lastInteractedAt: string, isInitialConversation: boolean) {
  const data: Conversation = {
    id,
    projectId: 'project-1',
    taskId: 'task-1',
    runtimeId: 'claude',
    title: id,
    lastInteractedAt,
    isInitialConversation,
  };
  return {
    data,
    isInitialConversation,
    seen: true,
    markSeen: () => {},
  };
}

function makeConversationManager(
  conversations: ReturnType<typeof makeConversation>[]
): ConversationManagerStore {
  return {
    conversations: observable.map(
      conversations.map((conversation) => [conversation.data.id, conversation])
    ),
  } as unknown as ConversationManagerStore;
}
