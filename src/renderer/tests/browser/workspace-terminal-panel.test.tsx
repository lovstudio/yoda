import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  terminal: null as { data: { id: string } } | null,
  fileLinks: { workspaceRoot: '/project', onOpen: vi.fn() },
  workbenchProps: null as Record<string, unknown> | null,
}));

vi.mock('lucide-react', () => ({
  Plus: () => null,
  Terminal: () => null,
  X: () => null,
}));

vi.mock('mobx-react-lite', () => ({
  observer: <T,>(component: T) => component,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@renderer/features/projects/stores/project-selectors', () => ({
  asMounted: vi.fn(),
  getProjectStore: vi.fn(),
}));

vi.mock('@renderer/features/tasks/terminals/terminal-log-context-menu', () => ({
  TerminalLogContextMenu: ({
    terminal,
    children,
  }: {
    terminal: typeof mocks.terminal;
    children: ReactNode;
  }) => {
    mocks.terminal = terminal;
    return createElement(
      'div',
      { 'data-terminal-context-menu': terminal?.data.id ?? '' },
      children
    );
  },
}));

vi.mock('@renderer/features/tasks/terminals/terminal-workbench', () => ({
  TerminalWorkbench: (props: Record<string, unknown>) => {
    mocks.workbenchProps = props;
    return createElement('div', { 'data-terminal-workbench': true });
  },
}));

vi.mock('@renderer/features/tasks/terminals/use-workspace-file-links', () => ({
  useDefaultWorkspaceFileLinks: () => mocks.fileLinks,
}));

vi.mock('@renderer/lib/stores/workspace-terminal-store', () => ({
  workspaceTerminalStore: {
    manager: { projectId: 'project-1', taskId: 'workspace' },
    tabs: {
      activeTabId: 'terminal-2',
      tabs: [{ data: { id: 'terminal-1' } }, { data: { id: 'terminal-2' } }],
    },
    activeProjectId: null,
    isOpen: true,
    error: null,
    createTerminal: vi.fn(),
    close: vi.fn(),
  },
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('WorkspaceTerminalPanel', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    mocks.terminal = null;
    mocks.workbenchProps = null;
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  it('gives the active quick-action terminal the shared log context menu', async () => {
    const { WorkspaceTerminalPanel } = await import('@renderer/app/workspace-terminal-panel');

    await act(async () => {
      root.render(createElement(WorkspaceTerminalPanel));
    });

    expect(mocks.terminal?.data.id).toBe('terminal-2');
    expect(host.querySelector('[data-terminal-context-menu="terminal-2"]')).not.toBeNull();
    expect(mocks.workbenchProps?.fileLinks).toBe(mocks.fileLinks);
    expect(mocks.workbenchProps?.webLinks).toBeNull();
  });
});
