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
