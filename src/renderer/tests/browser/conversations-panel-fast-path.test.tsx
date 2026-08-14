import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type VisibleFrameListener = (ready: boolean) => void;
type MockPty = {
  listeners: Set<VisibleFrameListener>;
  subscribeVisibleFrameState: ReturnType<typeof vi.fn>;
  emitVisibleFrame: (ready: boolean) => void;
};

const mocks = vi.hoisted(() => ({
  archivedHook: vi.fn(),
  conversationValues: vi.fn(),
  historyActive: vi.fn(),
  interfaceSettingsLoading: false,
  loadError: null as unknown | null,
  paneActiveSessionId: vi.fn(),
  paneSessionIds: vi.fn(),
  sessionProps: vi.fn(),
  sessionMounts: 0,
  sessionUnmounts: 0,
  hosted: false,
  activePty: null as MockPty | null,
  provisioned: null as unknown,
  retryLoad: vi.fn(),
  routeConversationId: 'conversation-1',
}));

function createMockPty(initialReady: boolean): MockPty {
  let ready = initialReady;
  const listeners = new Set<VisibleFrameListener>();
  return {
    listeners,
    subscribeVisibleFrameState: vi.fn((listener: VisibleFrameListener) => {
      listeners.add(listener);
      listener(ready);
      return () => listeners.delete(listener);
    }),
    emitVisibleFrame(nextReady: boolean) {
      ready = nextReady;
      for (const listener of listeners) listener(ready);
    },
  };
}

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@renderer/features/tasks/conversations/session-history-panel', async () => {
  const { createElement: create } = await import('react');
  return {
    DockedSessionHistory: ({ active }: { active?: boolean }) => {
      mocks.historyActive(active);
      return create(
        'div',
        {
          'data-session-history-dock': true,
          'data-history-active': String(active),
          style: { height: '157px' },
        },
        active ? 'transcript content' : null
      );
    },
  };
});

vi.mock('@renderer/features/tasks/hooks/use-is-active-task', () => ({
  useIsActiveTask: () => true,
}));

vi.mock('@renderer/features/settings/use-app-settings-key', () => ({
  useAppSettingsKey: () => ({ isLoading: mocks.interfaceSettingsLoading }),
}));

vi.mock('@renderer/features/tasks/split-view/split-view-store', () => ({
  splitViewStore: { has: () => false },
}));

vi.mock('@renderer/features/tasks/task-view-context', () => ({
  useTaskViewContext: () => ({
    projectId: 'project-1',
    taskId: 'task-1',
    hosted: mocks.hosted,
  }),
  useRequireProvisionedTask: () => mocks.provisioned,
}));

vi.mock('@renderer/lib/layout/navigation-provider', () => ({
  useParams: () => ({
    params: {
      tab: { kind: 'conversation', conversationId: mocks.routeConversationId },
    },
  }),
}));

vi.mock('@renderer/lib/modal/modal-provider', () => ({
  useShowModal: () => vi.fn(),
}));

vi.mock('@renderer/lib/ipc', () => ({ events: {}, rpc: {} }));

vi.mock('@renderer/lib/pty/pane-sizing-context', async () => {
  const { createElement: create } = await import('react');
  return {
    PaneSizingProvider: ({
      paneId,
      sessionIds,
      activeSessionId,
      registrationEnabled,
      children,
    }: {
      paneId: string;
      sessionIds: string[];
      activeSessionId: string | null;
      registrationEnabled?: boolean;
      children: React.ReactNode;
    }) => {
      mocks.paneActiveSessionId(activeSessionId);
      mocks.paneSessionIds(sessionIds);
      return create(
        'div',
        {
          'data-pane-id': paneId,
          'data-pane-session-ids': sessionIds.join(','),
          'data-registration-enabled': String(registrationEnabled),
        },
        children
      );
    },
  };
});

vi.mock('@renderer/features/tasks/conversations/conversation-session', async () => {
  const { useEffect } = await import('react');
  return {
    ConversationSession: (props: {
      isVisible: boolean;
      autoFocus: boolean;
      loadingSurface?: 'inline' | 'external';
    }) => {
      mocks.sessionProps(props);
      useEffect(() => {
        mocks.sessionMounts += 1;
        return () => {
          mocks.sessionUnmounts += 1;
        };
      }, []);
      return createElement('div', { 'data-conversation-session': true });
    },
    getResumeInitialSize: vi.fn(),
  };
});

vi.mock('@renderer/features/tasks/conversations/conversation-tree', () => ({
  ConversationTree: () => createElement('div'),
}));

vi.mock('@renderer/features/tasks/conversations/use-archived-conversations', () => ({
  useArchivedConversations: (...args: unknown[]) => mocks.archivedHook(...args),
}));

vi.mock('@renderer/utils/logger', () => ({
  log: { level: 'info', debug: vi.fn() },
}));

describe('ConversationsPanel active-session fast path', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    mocks.hosted = false;
    mocks.archivedHook.mockReset().mockReturnValue([]);
    mocks.conversationValues.mockReset().mockImplementation(() => {
      throw new Error('active session enumerated the conversation collection');
    });
    mocks.historyActive.mockReset();
    mocks.interfaceSettingsLoading = false;
    mocks.loadError = null;
    mocks.paneActiveSessionId.mockReset();
    mocks.paneSessionIds.mockReset();
    mocks.sessionProps.mockReset();
    mocks.sessionMounts = 0;
    mocks.sessionUnmounts = 0;
    mocks.routeConversationId = 'conversation-1';
    mocks.retryLoad.mockReset().mockResolvedValue(undefined);
    mocks.activePty = createMockPty(false);

    const conversation = {
      data: { id: 'conversation-1' },
      sessionExited: false,
      sessionResumeBlockReason: null,
      session: {
        sessionId: 'session-1',
        status: 'ready',
        pty: mocks.activePty,
        connectionError: null,
      },
    };
    const conversationMap = new Map();
    conversationMap.values = mocks.conversationValues;
    const tabManager = {
      activeConversation: conversation,
      activeDescriptor: {
        kind: 'conversation',
        tabId: 'conversation:conversation-1',
        conversationId: 'conversation-1',
      },
      activeConversationId: 'conversation-1',
      activeTabId: 'conversation:conversation-1',
    };
    Object.defineProperties(tabManager, {
      entries: {
        get: () => {
          throw new Error('active session inspected every tab entry');
        },
      },
      resolvedTabs: {
        get: () => {
          throw new Error('active session resolved every tab');
        },
      },
      tabOrder: {
        get: () => {
          throw new Error('active session scanned tab order');
        },
      },
    });
    mocks.provisioned = {
      conversations: {
        conversations: conversationMap,
        hasAuthoritativeSnapshot: true,
        loadError: mocks.loadError,
        retryLoad: mocks.retryLoad,
      },
      taskView: {
        focusedRegion: 'main',
        setFocusedRegion: vi.fn(),
        tabManager,
      },
    };

    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  it('mounts the final session and reserves its inactive history dock in the first layout', async () => {
    const { ConversationsPanel } = await import(
      '@renderer/features/tasks/conversations/conversations-panel'
    );
    await act(async () => root.render(createElement(ConversationsPanel)));

    expect(host.querySelector('[data-conversation-session]')).not.toBeNull();
    expect(
      host.querySelector('[data-pane-session-ids]')?.getAttribute('data-pane-session-ids')
    ).toBe('session-1');
    expect(host.querySelector('[data-pane-id]')?.getAttribute('data-pane-id')).toBe(
      'conversations:project-1:task-1'
    );
    expect(mocks.conversationValues).not.toHaveBeenCalled();
    expect(mocks.archivedHook).not.toHaveBeenCalled();
    expect(mocks.sessionProps.mock.lastCall?.[0]).toMatchObject({ loadingSurface: 'external' });
    expect(mocks.historyActive).toHaveBeenLastCalledWith(false);
    const reservedHistory = host.querySelector<HTMLElement>('[data-history-active="false"]');
    expect(reservedHistory?.style.height).toBe('157px');
    expect(host.querySelector('[data-conversation-opening-overlay]')).toBeNull();
    const { taskOpenTransitionStore } = await import(
      '@renderer/features/tasks/task-open-transition-store'
    );
    expect(taskOpenTransitionStore.isSessionOpening('project-1', 'task-1')).toBe(true);
    expect(host.textContent).not.toContain('transcript content');

    await act(async () => mocks.activePty?.emitVisibleFrame(true));
    await vi.waitFor(() => {
      expect(mocks.historyActive).toHaveBeenLastCalledWith(true);
      expect(host.querySelector('[data-history-active="true"]')).not.toBeNull();
      expect(taskOpenTransitionStore.isSessionOpening('project-1', 'task-1')).toBe(false);
      expect(host.textContent).toContain('transcript content');
    });
  });

  it('isolates hosted split-pane sizing from the primary conversation pane', async () => {
    mocks.hosted = true;
    const { ConversationsPanel } = await import(
      '@renderer/features/tasks/conversations/conversations-panel'
    );
    await act(async () => root.render(createElement(ConversationsPanel, { forceVisible: true })));

    expect(host.querySelector('[data-pane-id]')?.getAttribute('data-pane-id')).toBe(
      'conversations:project-1:task-1'
    );
  });

  it('does not expose the pane for canonical measurement before interface settings settle', async () => {
    mocks.interfaceSettingsLoading = true;
    const { ConversationsPanel } = await import(
      '@renderer/features/tasks/conversations/conversations-panel'
    );

    await act(async () => root.render(createElement(ConversationsPanel, { forceVisible: true })));
    expect(
      host.querySelector('[data-registration-enabled]')?.getAttribute('data-registration-enabled')
    ).toBe('false');

    mocks.interfaceSettingsLoading = false;
    await act(async () => root.render(createElement(ConversationsPanel)));
    expect(
      host.querySelector('[data-registration-enabled]')?.getAttribute('data-registration-enabled')
    ).toBe('true');
  });

  it('keeps one mounted session but disables its visible effects throughout task staging', async () => {
    const { taskOpenTransitionStore } = await import(
      '@renderer/features/tasks/task-open-transition-store'
    );
    const lease = taskOpenTransitionStore.begin('project-1', 'task-1');
    const { ConversationsPanel } = await import(
      '@renderer/features/tasks/conversations/conversations-panel'
    );

    await act(async () => root.render(createElement(ConversationsPanel)));
    expect(mocks.sessionProps.mock.lastCall?.[0]).toMatchObject({
      isVisible: false,
      autoFocus: false,
      loadingSurface: 'external',
    });
    expect(mocks.sessionMounts).toBe(1);
    expect(mocks.paneActiveSessionId).toHaveBeenLastCalledWith(null);
    expect(taskOpenTransitionStore.isSessionOpening('project-1', 'task-1')).toBe(true);
    expect(host.querySelector('[data-conversation-opening-overlay]')).toBeNull();
    expect(host.querySelector<HTMLElement>('[data-session-history-dock]')?.style.height).toBe(
      '157px'
    );

    taskOpenTransitionStore.complete('project-1', 'task-1', lease);
    await act(async () => root.render(createElement(ConversationsPanel)));
    expect(mocks.sessionProps.mock.lastCall?.[0]).toMatchObject({
      isVisible: true,
      autoFocus: true,
      loadingSurface: 'external',
    });
    expect(mocks.sessionMounts).toBe(1);
    expect(mocks.sessionUnmounts).toBe(0);
    expect(mocks.paneActiveSessionId).toHaveBeenLastCalledWith('session-1');
    expect(taskOpenTransitionStore.isSessionOpening('project-1', 'task-1')).toBe(true);
    expect(host.querySelector('[data-conversation-opening-overlay]')).toBeNull();
  });

  it('activates history only after the current PTY reports a painted frame', async () => {
    let nextFrameId = 0;
    const frames = new Map<number, FrameRequestCallback>();
    const requestFrame = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((callback: FrameRequestCallback) => {
        const id = ++nextFrameId;
        frames.set(id, callback);
        return id;
      });
    const cancelFrame = vi
      .spyOn(window, 'cancelAnimationFrame')
      .mockImplementation((id: number) => {
        frames.delete(id);
      });
    const flushFrame = async () => {
      const callbacks = [...frames.values()];
      frames.clear();
      await act(async () => {
        for (const callback of callbacks) callback(performance.now());
      });
    };

    try {
      const firstPty = createMockPty(false);
      mocks.activePty = firstPty;
      const activeConversation = (
        mocks.provisioned as {
          taskView: {
            tabManager: { activeConversation: { session: { pty: MockPty } } };
          };
        }
      ).taskView.tabManager.activeConversation;
      activeConversation.session.pty = firstPty;
      const { ConversationsPanel } = await import(
        '@renderer/features/tasks/conversations/conversations-panel'
      );
      await act(async () => root.render(createElement(ConversationsPanel)));
      expect(mocks.historyActive).toHaveBeenLastCalledWith(false);
      const staleListener = [...firstPty.listeners][0];
      expect(staleListener).toBeDefined();

      await flushFrame();
      expect(mocks.historyActive).toHaveBeenLastCalledWith(false);

      await act(async () => firstPty.emitVisibleFrame(true));
      expect(mocks.historyActive).toHaveBeenLastCalledWith(false);
      const { taskOpenTransitionStore } = await import(
        '@renderer/features/tasks/task-open-transition-store'
      );
      expect(taskOpenTransitionStore.isSessionOpening('project-1', 'task-1')).toBe(true);
      await flushFrame();
      expect(mocks.historyActive).toHaveBeenLastCalledWith(true);
      expect(taskOpenTransitionStore.isSessionOpening('project-1', 'task-1')).toBe(false);

      await act(async () => firstPty.emitVisibleFrame(false));
      expect(mocks.historyActive).toHaveBeenLastCalledWith(false);

      await act(async () => firstPty.emitVisibleFrame(true));
      const replacementPty = createMockPty(false);
      mocks.activePty = replacementPty;
      activeConversation.session.pty = replacementPty;
      await act(async () => root.render(createElement(ConversationsPanel, { forceVisible: true })));
      expect(mocks.historyActive).toHaveBeenLastCalledWith(false);

      await act(async () => {
        staleListener?.(true);
      });
      await flushFrame();
      expect(mocks.historyActive).toHaveBeenLastCalledWith(false);

      await act(async () => replacementPty.emitVisibleFrame(true));
      expect(mocks.historyActive).toHaveBeenLastCalledWith(false);
      await flushFrame();
      expect(mocks.historyActive).toHaveBeenLastCalledWith(true);
    } finally {
      requestFrame.mockRestore();
      cancelFrame.mockRestore();
    }
  });

  it('does not mount stale session chrome while the routed conversation is resolving', async () => {
    mocks.routeConversationId = 'conversation-2';
    const { ConversationsPanel } = await import(
      '@renderer/features/tasks/conversations/conversations-panel'
    );
    await act(async () => root.render(createElement(ConversationsPanel)));

    const { taskOpenTransitionStore } = await import(
      '@renderer/features/tasks/task-open-transition-store'
    );
    expect(taskOpenTransitionStore.isSessionOpening('project-1', 'task-1')).toBe(true);
    expect(host.querySelector('[data-conversation-opening-overlay]')).toBeNull();
    expect(host.querySelector('[data-conversation-session]')).toBeNull();
    expect(
      host.querySelector('[data-pane-session-ids]')?.getAttribute('data-pane-session-ids')
    ).toBe('');
    expect(mocks.historyActive).not.toHaveBeenCalled();

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(mocks.historyActive).not.toHaveBeenCalled();
  });

  it('removes the root loader when the session needs to expose preparation diagnostics', async () => {
    const activeConversation = (
      mocks.provisioned as {
        taskView: {
          tabManager: {
            activeConversation: {
              session: {
                status: string;
                pty: MockPty | null;
                connectionError: string | null;
              };
            };
          };
        };
      }
    ).taskView.tabManager.activeConversation;
    activeConversation.session.status = 'disconnected';
    activeConversation.session.pty = null;
    activeConversation.session.connectionError = 'Frontend PTY preparation failed';

    const { ConversationsPanel } = await import(
      '@renderer/features/tasks/conversations/conversations-panel'
    );
    await act(async () => root.render(createElement(ConversationsPanel)));

    const { taskOpenTransitionStore } = await import(
      '@renderer/features/tasks/task-open-transition-store'
    );
    expect(host.querySelector('[data-conversation-opening-overlay]')).toBeNull();
    expect(taskOpenTransitionStore.isSessionOpening('project-1', 'task-1')).toBe(false);
    expect(mocks.sessionProps.mock.lastCall?.[0]).toMatchObject({ loadingSurface: 'external' });
    expect(mocks.historyActive).toHaveBeenLastCalledWith(false);
    expect(host.querySelector<HTMLElement>('[data-session-history-dock]')?.style.height).toBe(
      '157px'
    );
  });

  it('removes the root loader when a stopped session needs to expose its retry UI', async () => {
    const activeConversation = (
      mocks.provisioned as {
        taskView: {
          tabManager: {
            activeConversation: {
              sessionExited: boolean;
            };
          };
        };
      }
    ).taskView.tabManager.activeConversation;
    activeConversation.sessionExited = true;

    const { ConversationsPanel } = await import(
      '@renderer/features/tasks/conversations/conversations-panel'
    );
    await act(async () => root.render(createElement(ConversationsPanel)));

    const { taskOpenTransitionStore } = await import(
      '@renderer/features/tasks/task-open-transition-store'
    );
    expect(taskOpenTransitionStore.isSessionOpening('project-1', 'task-1')).toBe(false);
    expect(mocks.sessionProps.mock.lastCall?.[0]).toMatchObject({ loadingSurface: 'external' });
    expect(mocks.historyActive).toHaveBeenLastCalledWith(false);
  });

  it('replaces an unrecoverable snapshot loader with a retryable error surface', async () => {
    const provisioned = mocks.provisioned as {
      conversations: {
        hasAuthoritativeSnapshot: boolean;
        loadError: unknown | null;
      };
    };
    provisioned.conversations.hasAuthoritativeSnapshot = false;
    provisioned.conversations.loadError = new Error('Conversation snapshot unavailable');

    const { ConversationsPanel } = await import(
      '@renderer/features/tasks/conversations/conversations-panel'
    );
    await act(async () => root.render(createElement(ConversationsPanel)));

    const { taskOpenTransitionStore } = await import(
      '@renderer/features/tasks/task-open-transition-store'
    );
    expect(taskOpenTransitionStore.isSessionOpening('project-1', 'task-1')).toBe(false);
    expect(taskOpenTransitionStore.hasSessionError('project-1', 'task-1')).toBe(true);
    expect(host.textContent).toContain('Conversation snapshot unavailable');
    expect(host.querySelector('[data-conversation-session]')).toBeNull();
    expect(mocks.historyActive).not.toHaveBeenCalled();

    const retryButton = host.querySelector<HTMLButtonElement>('button');
    expect(retryButton?.textContent).toBe('common.retry');
    await act(async () => retryButton?.click());
    expect(mocks.retryLoad).toHaveBeenCalledOnce();

    provisioned.conversations.loadError = null;
    provisioned.conversations.hasAuthoritativeSnapshot = true;
    await act(async () => root.render(createElement(ConversationsPanel, { forceVisible: true })));
    expect(taskOpenTransitionStore.hasSessionError('project-1', 'task-1')).toBe(false);
    expect(host.querySelector('[data-conversation-session]')).not.toBeNull();
  });

  it('clears its opening intent when the conversation surface unmounts', async () => {
    const { ConversationsPanel } = await import(
      '@renderer/features/tasks/conversations/conversations-panel'
    );
    const { taskOpenTransitionStore } = await import(
      '@renderer/features/tasks/task-open-transition-store'
    );

    await act(async () => root.render(createElement(ConversationsPanel)));
    expect(taskOpenTransitionStore.isSessionOpening('project-1', 'task-1')).toBe(true);

    await act(async () => root.render(null));
    expect(taskOpenTransitionStore.isSessionOpening('project-1', 'task-1')).toBe(false);
  });
});
