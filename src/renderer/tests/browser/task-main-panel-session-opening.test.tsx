import { act, createElement, useLayoutEffect, useRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  dockHeight: 0,
  paneHeightMeasurements: [] as number[],
  rerenderConversation: null as (() => void) | null,
  sessionOpening: true,
  showError: false,
  taskId: 'task-1',
  taskView: {
    activeRenderer: 'agents',
    isBottomPanelFullWidth: true,
    isSidebarCollapsed: true,
    isSidebarMaximized: false,
    isTerminalDrawerOpen: false,
    setFocusedRegion: vi.fn(),
    sidebarHalfWidthNonce: 0,
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@renderer/features/projects/stores/project-selectors', () => ({
  getProjectStore: () => ({}),
}));

vi.mock('@renderer/features/tasks/stores/task-selectors', () => ({
  getTaskManagerStore: () => ({ taskLoadPendingIds: new Set(), taskLoadState: 'loaded' }),
  getTaskStore: () => ({ data: {} }),
  taskErrorMessage: () => '',
}));

vi.mock('@renderer/features/tasks/task-view-context', () => ({
  useRequireProvisionedTask: () => ({ taskView: mocks.taskView }),
  useTaskViewContext: () => ({ projectId: 'project-1', taskId: mocks.taskId }),
  useTaskViewKind: () => 'ready',
}));

vi.mock('@renderer/features/tasks/components/session-opening-surface', () => ({
  SessionOpeningSurface: () =>
    createElement('div', { 'data-session-opening-surface': true }, 'Yoda'),
}));

vi.mock('@renderer/features/tasks/conversations/conversations-panel', async () => {
  const { taskOpenTransitionStore } = await import(
    '@renderer/features/tasks/task-open-transition-store'
  );

  return {
    ConversationsPanel: () => {
      const owner = useRef(Symbol('mock conversation panel'));
      const paneRef = useRef<HTMLDivElement>(null);
      const [, setRevision] = useState(0);
      mocks.rerenderConversation = () => setRevision((revision) => revision + 1);
      useLayoutEffect(() => {
        const height = paneRef.current?.getBoundingClientRect().height ?? 0;
        if (height > 0) mocks.paneHeightMeasurements.push(height);
      }, []);
      useLayoutEffect(() => {
        const token = owner.current;
        taskOpenTransitionStore.reportSessionOpening(
          'project-1',
          mocks.taskId,
          token,
          mocks.sessionOpening
        );
        taskOpenTransitionStore.reportSessionError(
          'project-1',
          mocks.taskId,
          token,
          mocks.showError
        );
        return () => {
          taskOpenTransitionStore.clearSessionOpening('project-1', mocks.taskId, token);
          taskOpenTransitionStore.clearSessionError('project-1', mocks.taskId, token);
        };
      });

      return createElement(
        'div',
        {
          'data-mock-conversations-panel': true,
          style: { display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 },
        },
        createElement(
          'div',
          {
            ref: paneRef,
            'data-mock-target-pane': true,
            style: { flex: '1 1 0%', minHeight: 0 },
          },
          mocks.showError
            ? createElement('div', { 'data-session-error-detail': true }, 'PTY preparation failed')
            : null
        ),
        createElement('div', {
          'data-mock-history-dock': true,
          style: { flexShrink: 0, height: `${mocks.dockHeight}px` },
        })
      );
    },
  };
});

vi.mock('@renderer/features/tasks/task-renderer-activity', () => ({
  TaskRendererActivity: ({ active, children }: { active: boolean; children: React.ReactNode }) =>
    active ? children : null,
}));

vi.mock('@renderer/features/tasks/editor/editor-provider', () => ({
  useEditorContext: () => ({ setEditorHost: vi.fn(), triggerLayout: vi.fn() }),
}));

vi.mock('@renderer/features/agent-room/room-member-detail', () => ({
  RoomMemberDetail: () => null,
}));
vi.mock('@renderer/features/tasks/bottom-panel', () => ({ BottomPanel: () => null }));
vi.mock('@renderer/features/tasks/components/file-actions', () => ({
  FileActionsDropdown: () => null,
  FileActionsOverlay: () => null,
}));
vi.mock('@renderer/features/tasks/components/task-provision-recovery', () => ({
  TaskProvisionRecovery: () => null,
}));
vi.mock('@renderer/features/tasks/diff-view/main-panel/diff-view', () => ({
  DiffView: () => null,
}));
vi.mock('@renderer/features/tasks/editor/editor-main-panel', () => ({
  EditorMainPanel: () => null,
}));
vi.mock('@renderer/features/tasks/editor/markdown-editor-panel', () => ({
  MarkdownEditorPanel: () => null,
}));
vi.mock('@renderer/features/tasks/task-titlebar', () => ({ ActiveTaskTitlebar: () => null }));
vi.mock('@renderer/features/tasks/view/overview-panel', () => ({ OverviewPanel: () => null }));
vi.mock('@renderer/features/tasks/view/task-sidebar', () => ({ TaskSidebar: () => null }));
vi.mock('@renderer/features/tasks/open-task-when-ready', () => ({ openTaskWhenReady: vi.fn() }));
vi.mock('@renderer/features/tasks/task-open-performance', () => ({
  completeTaskOpenTrace: vi.fn(),
  markTaskOpenTrace: vi.fn(),
}));
vi.mock('@renderer/lib/pty/terminal-clipboard', () => ({ writeTextToClipboard: vi.fn() }));

describe('TaskMainPanel session opening owner', () => {
  let host: HTMLDivElement;
  let root: Root;
  let style: HTMLStyleElement;

  beforeEach(() => {
    mocks.dockHeight = 0;
    mocks.paneHeightMeasurements = [];
    mocks.rerenderConversation = null;
    mocks.sessionOpening = true;
    mocks.showError = false;
    mocks.taskId = 'task-1';
    mocks.taskView.isBottomPanelFullWidth = true;
    mocks.taskView.isTerminalDrawerOpen = false;
    style = document.createElement('style');
    style.textContent = `
      .relative { position: relative; }
      .absolute { position: absolute; }
      .inset-0 { inset: 0; }
      .flex { display: flex; }
      .flex-1 { flex: 1 1 0%; }
      .flex-col { flex-direction: column; }
      .h-full { height: 100%; }
      .min-h-0 { min-height: 0; }
      .overflow-hidden { overflow: hidden; }
      .shrink-0 { flex-shrink: 0; }
      .w-full { width: 100%; }
    `;
    document.head.appendChild(style);
    host = document.createElement('div');
    host.style.width = '960px';
    host.style.height = '720px';
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    style.remove();
  });

  const waitForLayoutFrames = async () => {
    await act(
      () =>
        new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        })
    );
  };

  it('gives a cold closed drawer its final target-pane height on the first measurement', async () => {
    mocks.taskId = 'cold-closed-layout';
    mocks.sessionOpening = false;
    mocks.dockHeight = 157;
    const { TaskMainPanel } = await import('@renderer/features/tasks/main-panel');

    await act(async () => root.render(createElement(TaskMainPanel)));

    const group = host.querySelector<HTMLElement>('#task-main-vertical\\:cold-closed-layout');
    const mainPanel = host.querySelector<HTMLElement>('#task-main-content');
    const drawerPanel = host.querySelector<HTMLElement>('#task-terminal-drawer');
    const targetPane = host.querySelector<HTMLElement>('[data-mock-target-pane]');
    const firstMeasuredHeight = mocks.paneHeightMeasurements[0];

    expect(group?.getBoundingClientRect().height).toBe(720);
    expect(mainPanel?.getBoundingClientRect().height).toBe(720);
    expect(drawerPanel?.getBoundingClientRect().height).toBe(0);
    expect(firstMeasuredHeight).toBeGreaterThan(500);
    expect(firstMeasuredHeight).toBeCloseTo(targetPane?.getBoundingClientRect().height ?? 0, 0);

    await waitForLayoutFrames();

    expect(targetPane?.getBoundingClientRect().height).toBeCloseTo(firstMeasuredHeight, 0);
    expect(mainPanel?.getBoundingClientRect().height).toBe(720);
    expect(drawerPanel?.getBoundingClientRect().height).toBe(0);
  });

  it('starts an open drawer at 75/25 and restores a valid remembered open layout', async () => {
    mocks.taskId = 'remembered-open-layout';
    mocks.sessionOpening = false;
    mocks.taskView.isTerminalDrawerOpen = true;
    const { TaskMainPanel } = await import('@renderer/features/tasks/main-panel');

    await act(async () => root.render(createElement(TaskMainPanel)));
    await waitForLayoutFrames();

    const initialMainPanel = host.querySelector<HTMLElement>('#task-main-content');
    const initialDrawerPanel = host.querySelector<HTMLElement>('#task-terminal-drawer');
    const separator = host.querySelector<HTMLElement>('[data-slot="resizable-handle"]');
    expect(mocks.paneHeightMeasurements[0]).toBeCloseTo(540, 0);
    expect(initialMainPanel?.getBoundingClientRect().height).toBeCloseTo(540, 0);
    expect(initialDrawerPanel?.getBoundingClientRect().height).toBeCloseTo(180, 0);
    expect(separator).not.toBeNull();

    await act(async () => {
      separator?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true })
      );
      separator?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true })
      );
    });
    await waitForLayoutFrames();

    const rememberedMainHeight = initialMainPanel?.getBoundingClientRect().height ?? 0;
    const rememberedDrawerHeight = initialDrawerPanel?.getBoundingClientRect().height ?? 0;
    expect(rememberedMainHeight).toBeLessThan(540);
    expect(rememberedDrawerHeight).toBeGreaterThan(180);

    await act(async () => root.render(null));
    mocks.paneHeightMeasurements = [];
    await act(async () => root.render(createElement(TaskMainPanel)));

    const restoredMainPanel = host.querySelector<HTMLElement>('#task-main-content');
    const restoredDrawerPanel = host.querySelector<HTMLElement>('#task-terminal-drawer');
    expect(mocks.paneHeightMeasurements[0]).toBeCloseTo(rememberedMainHeight, 0);
    expect(restoredMainPanel?.getBoundingClientRect().height).toBeCloseTo(rememberedMainHeight, 0);
    expect(restoredDrawerPanel?.getBoundingClientRect().height).toBeCloseTo(
      rememberedDrawerHeight,
      0
    );
  });

  it('keeps one full-panel Logo fixed while the history dock enters the layout', async () => {
    const { TaskMainPanel } = await import('@renderer/features/tasks/main-panel');

    await act(async () => root.render(createElement(TaskMainPanel)));
    const firstOverlay = host.querySelector<HTMLElement>('[data-task-opening-overlay]');
    expect(firstOverlay).not.toBeNull();
    expect(host.querySelectorAll('[data-session-opening-surface]')).toHaveLength(1);
    const firstRect = firstOverlay?.getBoundingClientRect();

    mocks.dockHeight = 157;
    await act(async () => mocks.rerenderConversation?.());
    const dockedOverlay = host.querySelector<HTMLElement>('[data-task-opening-overlay]');
    const dockedRect = dockedOverlay?.getBoundingClientRect();

    expect(dockedOverlay).toBe(firstOverlay);
    expect(dockedRect).toMatchObject({
      height: firstRect?.height,
      left: firstRect?.left,
      top: firstRect?.top,
      width: firstRect?.width,
    });
    expect(dockedRect?.height).toBe(720);
    expect(dockedRect?.width).toBe(960);
    expect(host.querySelectorAll('[data-session-opening-surface]')).toHaveLength(1);
  });

  it('removes the Logo before exposing a session preparation error detail', async () => {
    const { TaskMainPanel } = await import('@renderer/features/tasks/main-panel');
    const { taskOpenTransitionStore } = await import(
      '@renderer/features/tasks/task-open-transition-store'
    );
    const transitionLease = taskOpenTransitionStore.begin('project-1', 'task-1');

    await act(async () => root.render(createElement(TaskMainPanel)));
    expect(host.querySelector('[data-task-opening-overlay]')).not.toBeNull();

    mocks.sessionOpening = false;
    mocks.showError = true;
    await act(async () => mocks.rerenderConversation?.());

    expect(host.querySelector('[data-task-opening-overlay]')).toBeNull();
    expect(host.querySelector('[data-session-opening-surface]')).toBeNull();
    expect(host.querySelector('[data-session-error-detail]')?.textContent).toContain(
      'PTY preparation failed'
    );
    taskOpenTransitionStore.complete('project-1', 'task-1', transitionLease);
  });
});
