import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConversationStore } from '@renderer/features/tasks/conversations/conversation-manager';
import type { FrontendPty } from '@renderer/lib/pty/pty';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  completeTaskOpenTrace: vi.fn(),
  markTaskOpenTrace: vi.fn(),
  logWarn: vi.fn(),
  pendingProps: vi.fn(),
  ptyFocus: vi.fn(),
  provisioned: null as unknown,
  agentStatus: 'idle' as 'idle' | 'working' | 'awaiting-input',
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: '/Users/test' }),
}));

vi.mock('@renderer/features/projects/stores/project-selectors', () => ({
  asMounted: () => undefined,
  getProjectStore: () => undefined,
}));

vi.mock('@renderer/features/tasks/hooks/use-attach-images-as-paths', () => ({
  useAttachImagesAsPaths: () => false,
}));

vi.mock('@renderer/features/tasks/stores/task-selectors', () => ({
  getConversationRuntimeStatus: () => mocks.agentStatus,
  getTaskStore: () => undefined,
}));

vi.mock('@renderer/features/tasks/task-view-context', () => ({
  useTaskViewContext: () => ({ projectId: 'project-1', taskId: 'task-1' }),
  useRequireProvisionedTask: () => mocks.provisioned,
}));

vi.mock('@renderer/features/tasks/terminals/use-workspace-file-links', () => ({
  useWorkspaceFileLinks: () => null,
}));

vi.mock('@renderer/features/tasks/terminals/use-workspace-web-links', () => ({
  useWorkspaceWebLinks: () => null,
}));

vi.mock('@renderer/lib/ipc', () => ({
  rpc: { app: { getHomeDir: vi.fn() } },
}));

vi.mock('@renderer/lib/pty/pty-pane', async () => {
  const { createElement: create, forwardRef, useImperativeHandle } = await import('react');
  return {
    PtyPane: forwardRef(function MockPtyPane(
      props: {
        autoAcknowledgeFrame?: boolean;
        allowAtomicLiveFrame?: boolean;
        inputEnabled?: boolean;
      },
      ref
    ) {
      useImperativeHandle(ref, () => ({ focus: mocks.ptyFocus }), []);
      return create('div', {
        'data-pty-pane': true,
        'data-auto-acknowledge-frame': String(props.autoAcknowledgeFrame),
        'data-allow-atomic-live-frame': String(props.allowAtomicLiveFrame),
        'data-input-enabled': String(props.inputEnabled),
      });
    }),
  };
});

vi.mock('@renderer/lib/pty/terminal-search-overlay', () => ({
  TerminalSearchOverlay: () => null,
}));

vi.mock('@renderer/lib/pty/use-terminal-search', () => ({
  useTerminalSearch: () => ({
    isSearchOpen: false,
    searchQuery: '',
    searchStatus: null,
    searchInputRef: { current: null },
    closeSearch: vi.fn(),
    handleSearchQueryChange: vi.fn(),
    stepSearch: vi.fn(),
  }),
}));

vi.mock('@renderer/utils/logger', () => ({
  log: { level: 'info', debug: vi.fn(), warn: mocks.logWarn },
}));

vi.mock('@renderer/features/tasks/task-open-performance', () => ({
  completeTaskOpenTrace: mocks.completeTaskOpenTrace,
  markTaskOpenTrace: mocks.markTaskOpenTrace,
}));

vi.mock('@renderer/features/tasks/conversations/conversation-session-pending-state', () => ({
  ConversationSessionPendingState: (props: { error?: { tone?: string } }) => {
    mocks.pendingProps(props);
    return createElement(
      'div',
      {
        'data-conversation-session-pending': true,
        'data-conversation-session-error': String(Boolean(props.error)),
        // A slow canonical frame surfaces a retry affordance without claiming
        // the session failed. Keep the two distinguishable in assertions.
        'data-conversation-session-tone': props.error ? (props.error.tone ?? 'error') : 'none',
      },
      'pending'
    );
  },
}));

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

function createVisibleFramePty(initialReady: boolean) {
  let frameReady = initialReady;
  let frameStateListener: ((ready: boolean) => void) | null = null;
  const releaseCanonicalRevealClaim = vi.fn();
  const pty = {
    hasRecoverableSnapshot: true,
    terminal: { textarea: document.createElement('textarea'), cols: 120, rows: 40 },
    waitForVisibleFrame: vi.fn(() => new Promise<boolean>(() => {})),
    subscribeVisibleFrameState: vi.fn((listener: (ready: boolean) => void) => {
      frameStateListener = listener;
      listener(frameReady);
      return () => {
        if (frameStateListener === listener) frameStateListener = null;
      };
    }),
    releaseCanonicalRevealClaim,
  } as unknown as FrontendPty;

  return {
    pty,
    releaseCanonicalRevealClaim,
    emit(ready: boolean) {
      frameReady = ready;
      frameStateListener?.(ready);
    },
  };
}

describe('ConversationSession visible-frame generation retry', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.agentStatus = 'idle';
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    document
      .querySelectorAll('[data-visible-frame-fixture]')
      .forEach((element) => element.remove());
  });

  it('retries a timed-out generation without new output and waits for a dialog before focus', async () => {
    const firstWait = deferred<boolean>();
    const retryWait = deferred<boolean>();
    const waits = [firstWait, retryWait];
    let frameStateListener: ((ready: boolean) => void) | null = null;
    let waitIndex = 0;
    let activeWaits = 0;
    let maxActiveWaits = 0;

    const waitForVisibleFrame = vi.fn(async () => {
      const wait = waits[waitIndex++];
      if (!wait) throw new Error('Unexpected concurrent or extra visible-frame wait');
      activeWaits += 1;
      maxActiveWaits = Math.max(maxActiveWaits, activeWaits);
      try {
        return await wait.promise;
      } finally {
        activeWaits -= 1;
      }
    });
    const subscribeVisibleFrameState = vi.fn((listener: (ready: boolean) => void) => {
      frameStateListener = listener;
      // The same frontend PTY has already painted generation G1.
      listener(true);
      return () => {
        if (frameStateListener === listener) frameStateListener = null;
      };
    });
    const terminalTextarea = document.createElement('textarea');
    terminalTextarea.dataset.visibleFrameFixture = 'true';
    document.body.appendChild(terminalTextarea);
    mocks.ptyFocus.mockImplementation(() => terminalTextarea.focus());
    const dialog = document.createElement('div');
    dialog.dataset.visibleFrameFixture = 'true';
    dialog.setAttribute('role', 'dialog');
    document.body.appendChild(dialog);
    const pty = {
      hasRecoverableSnapshot: true,
      terminal: { textarea: terminalTextarea, cols: 120, rows: 40 },
      waitForVisibleFrame,
      subscribeVisibleFrameState,
      releaseCanonicalRevealClaim: vi.fn(),
    } as unknown as FrontendPty;
    const session = {
      sessionId: 'project-1:task-1:conversation-1',
      status: 'ready',
      pty,
      connectionError: null,
      connect: vi.fn(async () => undefined),
      reconnect: vi.fn(async () => undefined),
    };
    const conversation = {
      data: {
        id: 'conversation-1',
        title: 'Visible frame retry',
        projectId: 'project-1',
        taskId: 'task-1',
        runtimeId: 'codex',
        sessionSource: { runtimeId: 'codex' },
      },
      session,
      status: 'idle',
      sessionExited: false,
      sessionExitNoticeDismissed: false,
      setWorking: vi.fn(),
      clearWorking: vi.fn(),
      dismissSessionExitNotice: vi.fn(),
    } as unknown as ConversationStore;
    mocks.provisioned = {
      path: '/workspace/project-1',
      conversations: {
        reconcileSessionLiveness: vi.fn(async () => undefined),
        resumeConversation: vi.fn(async () => true),
        restartConversation: vi.fn(async () => undefined),
        touchConversation: vi.fn(async () => undefined),
      },
      taskView: {
        setFocusedRegion: vi.fn(),
        setSidebarCollapsed: vi.fn(),
        tabManager: { openFileInSidebar: vi.fn() },
      },
    };

    const { ConversationSession } = await import(
      '@renderer/features/tasks/conversations/conversation-session'
    );
    await act(async () => {
      root.render(
        createElement(ConversationSession, {
          conversation,
          isVisible: true,
          autoFocus: true,
        })
      );
    });

    expect(subscribeVisibleFrameState).toHaveBeenCalledOnce();
    expect(waitForVisibleFrame).not.toHaveBeenCalled();
    expect(host.querySelector('[data-conversation-session-pending]')).toBeNull();

    // Generation G2 starts on this same FrontendPty. No data/output event is
    // delivered after this authoritative false transition.
    await act(async () => frameStateListener?.(false));

    expect(host.querySelector('[data-conversation-session-pending]')).not.toBeNull();
    expect(waitForVisibleFrame).toHaveBeenCalledTimes(1);
    expect(activeWaits).toBe(1);

    // The first generation wait reaches its timeout. The component must retry
    // on its own; it cannot depend on another PTY byte to wake the overlay.
    await act(async () => {
      firstWait.resolve(false);
      await firstWait.promise;
    });

    await vi.waitFor(() => expect(waitForVisibleFrame).toHaveBeenCalledTimes(2));
    expect(activeWaits).toBe(1);
    expect(maxActiveWaits).toBe(1);
    expect(host.querySelector('[data-conversation-session-pending]')).not.toBeNull();

    await act(async () => {
      retryWait.resolve(true);
      await retryWait.promise;
    });

    await vi.waitFor(() => {
      expect(host.querySelector('[data-conversation-session-pending]')).toBeNull();
    });
    expect(waitForVisibleFrame).toHaveBeenCalledTimes(2);
    expect(activeWaits).toBe(0);
    expect(maxActiveWaits).toBe(1);
    expect(mocks.ptyFocus).not.toHaveBeenCalled();

    dialog.remove();
    await vi.waitFor(() => expect(mocks.ptyFocus).toHaveBeenCalledOnce());
    expect(document.activeElement).toBe(terminalTextarea);
    terminalTextarea.remove();
  });

  it('releases a claim only after the committed frame paints and cancels stale releases', async () => {
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
      const current = createVisibleFramePty(true);
      const session = {
        sessionId: 'project-1:task-1:conversation-1',
        status: 'ready',
        pty: current.pty,
        connectionError: null,
        connect: vi.fn(async () => undefined),
        reconnect: vi.fn(async () => undefined),
      };
      const conversation = {
        data: {
          id: 'conversation-1',
          title: 'Claimed visible frame',
          projectId: 'project-1',
          taskId: 'task-1',
          runtimeId: 'codex',
          sessionSource: { runtimeId: 'codex' },
        },
        session,
        status: 'idle',
        sessionExited: false,
        sessionExitNoticeDismissed: false,
        setWorking: vi.fn(),
        clearWorking: vi.fn(),
        dismissSessionExitNotice: vi.fn(),
      } as unknown as ConversationStore;
      mocks.provisioned = {
        path: '/workspace/project-1',
        conversations: {
          reconcileSessionLiveness: vi.fn(async () => undefined),
          resumeConversation: vi.fn(async () => true),
          restartConversation: vi.fn(async () => undefined),
          touchConversation: vi.fn(async () => undefined),
        },
        taskView: {
          setFocusedRegion: vi.fn(),
          setSidebarCollapsed: vi.fn(),
          tabManager: { openFileInSidebar: vi.fn() },
        },
      };

      const { ConversationSession } = await import(
        '@renderer/features/tasks/conversations/conversation-session'
      );
      let renderedConversation = conversation;
      const renderSession = () =>
        root.render(
          createElement(ConversationSession, {
            conversation: renderedConversation,
            isVisible: true,
            autoFocus: false,
          })
        );

      await act(async () => renderSession());

      expect(host.querySelector('[data-conversation-session-pending]')).toBeNull();
      expect(current.releaseCanonicalRevealClaim).not.toHaveBeenCalled();
      await flushFrame();
      expect(current.releaseCanonicalRevealClaim).toHaveBeenCalledOnce();
      current.releaseCanonicalRevealClaim.mockClear();

      // A newer generation can revoke readiness after React committed true but
      // before the following paint. Its queued release must be cancelled.
      await act(async () => current.emit(false));
      await act(async () => current.emit(true));
      expect(host.querySelector('[data-conversation-session-pending]')).toBeNull();
      expect(current.releaseCanonicalRevealClaim).not.toHaveBeenCalled();
      await act(async () => current.emit(false));
      expect(host.querySelector('[data-conversation-session-pending]')).not.toBeNull();
      await flushFrame();
      expect(current.releaseCanonicalRevealClaim).not.toHaveBeenCalled();

      // Replacing the FrontendPty identity also revokes the old scheduled paint.
      await act(async () => current.emit(true));
      const replacement = createVisibleFramePty(false);
      session.pty = replacement.pty;
      renderedConversation = { ...conversation, session } as unknown as ConversationStore;
      await act(async () => renderSession());
      expect(host.querySelector('[data-conversation-session-pending]')).not.toBeNull();
      await flushFrame();
      expect(current.releaseCanonicalRevealClaim).not.toHaveBeenCalled();
      expect(replacement.releaseCanonicalRevealClaim).not.toHaveBeenCalled();

      await act(async () => replacement.emit(true));
      expect(host.querySelector('[data-conversation-session-pending]')).toBeNull();
      expect(replacement.releaseCanonicalRevealClaim).not.toHaveBeenCalled();
      await flushFrame();
      expect(replacement.releaseCanonicalRevealClaim).toHaveBeenCalledOnce();
    } finally {
      requestFrame.mockRestore();
      cancelFrame.mockRestore();
    }
  });

  it('delegates ordinary loading to its owner but keeps preparation errors inline', async () => {
    const current = createVisibleFramePty(false);
    const session = {
      sessionId: 'project-1:task-1:conversation-1',
      status: 'ready',
      pty: current.pty as FrontendPty | null,
      connectionError: null as string | null,
      connect: vi.fn(async () => undefined),
      reconnect: vi.fn(async () => undefined),
    };
    const conversation = {
      data: {
        id: 'conversation-1',
        title: 'Externally staged frame',
        projectId: 'project-1',
        taskId: 'task-1',
        runtimeId: 'codex',
        sessionSource: { runtimeId: 'codex' },
      },
      session,
      status: 'idle',
      sessionExited: false,
      sessionExitNoticeDismissed: false,
      setWorking: vi.fn(),
      clearWorking: vi.fn(),
      dismissSessionExitNotice: vi.fn(),
    } as unknown as ConversationStore;
    mocks.provisioned = {
      path: '/workspace/project-1',
      conversations: {
        reconcileSessionLiveness: vi.fn(async () => undefined),
        resumeConversation: vi.fn(async () => true),
        restartConversation: vi.fn(async () => undefined),
        touchConversation: vi.fn(async () => undefined),
      },
      taskView: {
        setFocusedRegion: vi.fn(),
        setSidebarCollapsed: vi.fn(),
        tabManager: { openFileInSidebar: vi.fn() },
      },
    };

    const { ConversationSession } = await import(
      '@renderer/features/tasks/conversations/conversation-session'
    );
    const renderSession = (isVisible: boolean) =>
      root.render(
        createElement(ConversationSession, {
          // The production PtySession is MobX-observable. This focused test
          // uses a plain object, so replace the prop identity when mutating it
          // instead of relying on observer notifications that do not exist in
          // the fixture.
          conversation: { ...conversation, session } as unknown as ConversationStore,
          isVisible,
          autoFocus: false,
          loadingSurface: 'external',
        })
      );

    await act(async () => renderSession(true));
    expect(host.querySelector('[data-pty-pane]')).not.toBeNull();
    expect(host.querySelector('[data-pty-pane]')?.getAttribute('data-auto-acknowledge-frame')).toBe(
      'true'
    );
    expect(
      host.querySelector('[data-pty-pane]')?.getAttribute('data-allow-atomic-live-frame')
    ).toBe('false');
    expect(host.querySelector('[data-conversation-session-pending]')).toBeNull();

    // A genuine PTY preparation error keeps the terminal available for
    // diagnostics while replacing the owner's Logo with an actionable error.
    session.connectionError = 'Frontend PTY preparation failed';
    await act(async () => renderSession(true));
    expect(host.querySelector('[data-pty-pane]')).not.toBeNull();
    expect(
      host
        .querySelector('[data-conversation-session-pending]')
        ?.getAttribute('data-conversation-session-error')
    ).toBe('true');
    expect(
      host
        .querySelector('[data-conversation-session-pending]')
        ?.getAttribute('data-conversation-session-tone')
    ).toBe('error');
    session.connectionError = null;
    await act(async () => renderSession(true));

    // The destination remains mounted and measurable under TaskMainPanel's
    // opaque Logo, but it must not start an autonomous five-second paint ACK.
    await act(async () => renderSession(false));
    expect(host.querySelector('[data-pty-pane]')?.getAttribute('data-auto-acknowledge-frame')).toBe(
      'false'
    );
    await act(async () => renderSession(true));

    session.status = 'disconnected';
    session.pty = null;
    session.connectionError = 'Frontend PTY preparation failed';
    await act(async () => renderSession(false));

    expect(host.querySelector('[data-conversation-session-pending]')).not.toBeNull();
    expect(
      host
        .querySelector('[data-conversation-session-pending]')
        ?.getAttribute('data-conversation-session-error')
    ).toBe('true');
    expect(mocks.pendingProps.mock.lastCall?.[0]?.error).toBeDefined();
  });

  it('keeps a slow canonical frame subscribed and reveals it when it eventually arrives', async () => {
    vi.useFakeTimers();
    try {
      const current = createVisibleFramePty(false);
      Object.assign(current.pty, { canonicalGeneration: 7 });
      vi.mocked(current.pty.waitForVisibleFrame).mockResolvedValue(false);
      const session = {
        sessionId: 'project-1:task-1:conversation-timeout',
        status: 'ready',
        pty: current.pty,
        connectionError: null as string | null,
        connect: vi.fn(async () => undefined),
        reconnect: vi.fn(async () => undefined),
        reportConnectionError: vi.fn<(error: unknown) => void>(),
      };
      const conversation = {
        data: {
          id: 'conversation-timeout',
          title: 'Bounded visible frame',
          projectId: 'project-1',
          taskId: 'task-1',
          runtimeId: 'codex',
          sessionSource: { runtimeId: 'codex' },
        },
        session,
        status: 'idle',
        sessionExited: false,
        sessionExitNoticeDismissed: false,
        setWorking: vi.fn(),
        clearWorking: vi.fn(),
        dismissSessionExitNotice: vi.fn(),
      } as unknown as ConversationStore;
      const restartConversation = vi.fn(async () => undefined);
      mocks.provisioned = {
        path: '/workspace/project-1',
        conversations: {
          reconcileSessionLiveness: vi.fn(async () => undefined),
          resumeConversation: vi.fn(async () => true),
          restartConversation,
          touchConversation: vi.fn(async () => undefined),
        },
        taskView: {
          setFocusedRegion: vi.fn(),
          setSidebarCollapsed: vi.fn(),
          tabManager: { openFileInSidebar: vi.fn() },
        },
      };

      const { ConversationSession } = await import(
        '@renderer/features/tasks/conversations/conversation-session'
      );
      const { taskOpenTransitionStore } = await import(
        '@renderer/features/tasks/task-open-transition-store'
      );
      await act(async () => {
        root.render(
          createElement(ConversationSession, {
            conversation,
            isVisible: true,
            autoFocus: false,
            loadingSurface: 'external',
          })
        );
      });
      expect(host.querySelector('[data-conversation-session-pending]')).toBeNull();
      expect(taskOpenTransitionStore.hasSessionError('project-1', 'task-1')).toBe(false);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(30_100);
      });

      expect(session.reportConnectionError).not.toHaveBeenCalled();
      expect(session.connectionError).toBeNull();
      expect(
        host
          .querySelector('[data-conversation-session-pending]')
          ?.getAttribute('data-conversation-session-error')
      ).toBe('true');
      // Verification that is merely slow is still making progress. It may offer
      // a retry, but it must never be dressed as a failed session.
      expect(
        host
          .querySelector('[data-conversation-session-pending]')
          ?.getAttribute('data-conversation-session-tone')
      ).toBe('notice');
      expect(taskOpenTransitionStore.hasSessionError('project-1', 'task-1')).toBe(true);
      expect(vi.mocked(current.pty.waitForVisibleFrame).mock.calls.length).toBeGreaterThan(2);
      expect(mocks.logWarn).toHaveBeenCalledOnce();
      expect(mocks.logWarn).toHaveBeenCalledWith(
        '[conversation-session] canonical frame is still pending',
        expect.objectContaining({
          sessionId: 'project-1:task-1:conversation-timeout',
          generation: 7,
          elapsedMs: expect.any(Number),
        })
      );

      const retry = mocks.pendingProps.mock.lastCall?.[0]?.error as
        | { onRetry: () => void }
        | undefined;
      const waitsBeforeRetry = vi.mocked(current.pty.waitForVisibleFrame).mock.calls.length;
      const connectsBeforeRetry = session.connect.mock.calls.length;
      await act(async () => retry?.onRetry());

      expect(host.querySelector('[data-conversation-session-pending]')).toBeNull();
      expect(taskOpenTransitionStore.hasSessionError('project-1', 'task-1')).toBe(false);
      expect(vi.mocked(current.pty.waitForVisibleFrame).mock.calls.length).toBeGreaterThan(
        waitsBeforeRetry
      );
      expect(session.connect).toHaveBeenCalledTimes(connectsBeforeRetry);
      expect(session.reconnect).not.toHaveBeenCalled();
      expect(restartConversation).not.toHaveBeenCalled();
      expect(session.reportConnectionError).not.toHaveBeenCalled();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(30_100);
      });
      expect(
        host
          .querySelector('[data-conversation-session-pending]')
          ?.getAttribute('data-conversation-session-error')
      ).toBe('true');
      expect(taskOpenTransitionStore.hasSessionError('project-1', 'task-1')).toBe(true);
      expect(mocks.logWarn).toHaveBeenCalledTimes(2);

      await act(async () => current.emit(true));

      expect(host.querySelector('[data-conversation-session-pending]')).toBeNull();
      expect(taskOpenTransitionStore.hasSessionError('project-1', 'task-1')).toBe(false);
      expect(session.reconnect).not.toHaveBeenCalled();
      expect(restartConversation).not.toHaveBeenCalled();
      expect(session.reportConnectionError).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('resumes a recoverable snapshot and explicitly retries one false result', async () => {
    vi.useFakeTimers();
    try {
      const current = createVisibleFramePty(true);
      const session = {
        sessionId: 'project-1:task-1:conversation-1',
        status: 'ready',
        pty: current.pty,
        connectionError: null,
        connect: vi.fn(async () => undefined),
        reconnect: vi.fn(async () => undefined),
      };
      const conversation = {
        data: {
          id: 'conversation-1',
          title: 'Recoverable renderer snapshot',
          projectId: 'project-1',
          taskId: 'task-1',
          runtimeId: 'codex',
          sessionSource: { runtimeId: 'codex' },
        },
        session,
        status: 'idle',
        sessionExited: false,
        sessionExitNoticeDismissed: false,
        setWorking: vi.fn(),
        clearWorking: vi.fn(),
        dismissSessionExitNotice: vi.fn(),
      } as unknown as ConversationStore;
      const resumeConversation = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
      const reconcileSessionLiveness = vi.fn(async () => undefined);
      mocks.provisioned = {
        path: '/workspace/project-1',
        conversations: {
          reconcileSessionLiveness,
          resumeConversation,
          restartConversation: vi.fn(async () => undefined),
          touchConversation: vi.fn(async () => undefined),
        },
        taskView: {
          setFocusedRegion: vi.fn(),
          setSidebarCollapsed: vi.fn(),
          tabManager: { openFileInSidebar: vi.fn() },
        },
      };

      const { ConversationSession } = await import(
        '@renderer/features/tasks/conversations/conversation-session'
      );
      await act(async () => {
        root.render(
          createElement(ConversationSession, {
            conversation,
            isVisible: true,
            autoFocus: false,
          })
        );
      });

      expect(current.pty.hasRecoverableSnapshot).toBe(true);
      expect(reconcileSessionLiveness).toHaveBeenCalledOnce();
      expect(resumeConversation).toHaveBeenCalledOnce();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(150);
      });
      expect(resumeConversation).toHaveBeenCalledTimes(2);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_000);
      });
      expect(resumeConversation).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('turns a permanently pending resume into one stopped state without retrying forever', async () => {
    vi.useFakeTimers();
    try {
      const current = createVisibleFramePty(true);
      const markSessionExited = vi.fn();
      const conversation = {
        data: {
          id: 'conversation-1',
          title: 'Pending backend resume',
          projectId: 'project-1',
          taskId: 'task-1',
          runtimeId: 'codex',
          sessionSource: { runtimeId: 'codex' },
        },
        session: {
          sessionId: 'project-1:task-1:conversation-1',
          status: 'ready',
          pty: current.pty,
          connectionError: null,
          connect: vi.fn(async () => undefined),
          reconnect: vi.fn(async () => undefined),
        },
        status: 'idle',
        sessionExited: false,
        sessionExitNoticeDismissed: false,
        markSessionExited,
        setWorking: vi.fn(),
        clearWorking: vi.fn(),
        dismissSessionExitNotice: vi.fn(),
      } as unknown as ConversationStore;
      const resumeConversation = vi.fn(() => new Promise<boolean>(() => {}));
      mocks.provisioned = {
        path: '/workspace/project-1',
        conversations: {
          reconcileSessionLiveness: vi.fn(async () => undefined),
          resumeConversation,
          restartConversation: vi.fn(async () => undefined),
          touchConversation: vi.fn(async () => undefined),
        },
        taskView: {
          setFocusedRegion: vi.fn(),
          setSidebarCollapsed: vi.fn(),
          tabManager: { openFileInSidebar: vi.fn() },
        },
      };

      const { ConversationSession } = await import(
        '@renderer/features/tasks/conversations/conversation-session'
      );
      await act(async () => {
        root.render(
          createElement(ConversationSession, {
            conversation,
            isVisible: true,
            autoFocus: false,
            loadingSurface: 'external',
          })
        );
      });
      expect(resumeConversation).toHaveBeenCalledOnce();
      expect(markSessionExited).not.toHaveBeenCalled();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_999);
      });
      expect(markSessionExited).not.toHaveBeenCalled();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
      });
      expect(markSessionExited).toHaveBeenCalledOnce();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000);
      });
      expect(resumeConversation).toHaveBeenCalledOnce();
      expect(markSessionExited).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it('only enables atomic live frames after the provider confirms the running turn', async () => {
    const current = createVisibleFramePty(true);
    const conversation = {
      data: {
        id: 'conversation-1',
        title: 'Live frame policy',
        projectId: 'project-1',
        taskId: 'task-1',
        runtimeId: 'codex',
        sessionSource: { runtimeId: 'codex' },
      },
      session: {
        sessionId: 'project-1:task-1:conversation-1',
        status: 'ready',
        pty: current.pty,
        connectionError: null,
        connect: vi.fn(async () => undefined),
        reconnect: vi.fn(async () => undefined),
      },
      status: 'idle',
      providerTurnConfirmed: false,
      sessionExited: false,
      sessionExitNoticeDismissed: false,
      setWorking: vi.fn(),
      clearWorking: vi.fn(),
      dismissSessionExitNotice: vi.fn(),
    } as unknown as ConversationStore;
    mocks.provisioned = {
      path: '/workspace/project-1',
      conversations: {
        reconcileSessionLiveness: vi.fn(async () => undefined),
        resumeConversation: vi.fn(async () => true),
        restartConversation: vi.fn(async () => undefined),
        touchConversation: vi.fn(async () => undefined),
      },
      taskView: {
        setFocusedRegion: vi.fn(),
        setSidebarCollapsed: vi.fn(),
        tabManager: { openFileInSidebar: vi.fn() },
      },
    };

    const { ConversationSession } = await import(
      '@renderer/features/tasks/conversations/conversation-session'
    );
    let renderedConversation = conversation;
    const renderSession = () =>
      root.render(
        createElement(ConversationSession, {
          conversation: renderedConversation,
          isVisible: true,
          autoFocus: false,
        })
      );

    await act(async () => renderSession());
    expect(
      host
        .querySelector('[data-allow-atomic-live-frame]')
        ?.getAttribute('data-allow-atomic-live-frame')
    ).toBe('false');

    mocks.agentStatus = 'working';
    renderedConversation = {
      ...conversation,
      providerTurnConfirmed: false,
    } as unknown as ConversationStore;
    await act(async () => renderSession());
    expect(
      host
        .querySelector('[data-allow-atomic-live-frame]')
        ?.getAttribute('data-allow-atomic-live-frame')
    ).toBe('false');

    renderedConversation = {
      ...conversation,
      providerTurnConfirmed: true,
    } as unknown as ConversationStore;
    await act(async () => renderSession());
    expect(
      host
        .querySelector('[data-allow-atomic-live-frame]')
        ?.getAttribute('data-allow-atomic-live-frame')
    ).toBe('true');

    mocks.agentStatus = 'awaiting-input';
    renderedConversation = {
      ...conversation,
      providerTurnConfirmed: true,
    } as unknown as ConversationStore;
    await act(async () => renderSession());
    expect(
      host
        .querySelector('[data-allow-atomic-live-frame]')
        ?.getAttribute('data-allow-atomic-live-frame')
    ).toBe('true');
  });

  it('shows an external-writer state while keeping the transcript terminal read-only', async () => {
    const current = createVisibleFramePty(true);
    const conversation = {
      data: {
        id: 'conversation-1',
        title: 'Externally owned conversation',
        projectId: 'project-1',
        taskId: 'task-1',
        runtimeId: 'codex',
        sessionSource: { runtimeId: 'codex', sessionId: 'thread-1' },
      },
      session: {
        sessionId: 'project-1:task-1:conversation-1',
        status: 'ready',
        pty: current.pty,
        connectionError: null,
        connect: vi.fn(async () => undefined),
        reconnect: vi.fn(async () => undefined),
      },
      status: 'idle',
      sessionExited: false,
      sessionResumeBlockReason: 'external-writer',
      sessionExitNoticeDismissed: false,
      setWorking: vi.fn(),
      clearWorking: vi.fn(),
      dismissSessionExitNotice: vi.fn(),
    } as unknown as ConversationStore;
    mocks.provisioned = {
      path: '/workspace/project-1',
      conversations: {
        reconcileSessionLiveness: vi.fn(async () => undefined),
        resumeConversation: vi.fn(async () => false),
        restartConversation: vi.fn(async () => undefined),
        touchConversation: vi.fn(async () => undefined),
      },
      taskView: {
        setFocusedRegion: vi.fn(),
        setSidebarCollapsed: vi.fn(),
        tabManager: { openFileInSidebar: vi.fn() },
      },
    };

    const { ConversationSession } = await import(
      '@renderer/features/tasks/conversations/conversation-session'
    );
    await act(async () => {
      root.render(
        createElement(ConversationSession, {
          conversation,
          isVisible: true,
          autoFocus: false,
          loadingSurface: 'external',
        })
      );
    });

    expect(host.querySelector('[data-pty-pane]')?.getAttribute('data-input-enabled')).toBe('false');
    expect(host.textContent).toContain('tasks.conversations.externalWriter');
    expect(host.querySelector('[data-conversation-session-pending]')).toBeNull();
  });
});
