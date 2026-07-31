import { act, createElement, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TerminalStore } from '@renderer/features/tasks/terminals/terminal-manager';

const mocks = vi.hoisted(() => ({
  clipboardWriteText: vi.fn(),
  exportTerminalLog: vi.fn(),
  toast: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@renderer/lib/components/chip-context-menu', async () => {
  const { createElement: create, Fragment } = await import('react');
  return {
    ChipContextMenu: ({ sections, children }: { sections: ReactNode[][]; children: ReactNode }) =>
      create(Fragment, null, children, ...sections.flat()),
  };
});

vi.mock('@renderer/lib/ui/context-menu', async () => {
  const { createElement: create } = await import('react');
  return {
    ContextMenuItem: ({
      children,
      ...props
    }: ButtonHTMLAttributes<HTMLButtonElement> & { children?: ReactNode }) =>
      create('button', props, children),
  };
});

vi.mock('@renderer/lib/hooks/use-toast', () => ({ toast: mocks.toast }));

vi.mock('@renderer/lib/ipc', () => ({
  rpc: {
    app: { clipboardWriteText: mocks.clipboardWriteText },
    pty: { exportTerminalLog: mocks.exportTerminalLog },
  },
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function terminal(): TerminalStore {
  return {
    data: {
      id: 'terminal-1',
      name: 'Dev server',
      projectId: 'project-1',
      taskId: 'task-1',
    },
    session: { sessionId: 'project-1:task-1:terminal-1' },
  } as unknown as TerminalStore;
}

function button(host: HTMLElement, label: string): HTMLButtonElement {
  const target = Array.from(host.querySelectorAll('button')).find(
    (candidate) => candidate.textContent === label
  );
  if (!target) throw new Error(`Missing button: ${label}`);
  return target;
}

describe('TerminalLogContextMenu', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.clipboardWriteText.mockResolvedValue({ success: true });
    mocks.exportTerminalLog.mockResolvedValue({
      success: true,
      data: {
        path: '/tmp/terminal.log',
        content: 'server ready',
        capturedAt: '2026-07-31T00:00:00.000Z',
        contentBytes: 12,
        ringBufferBytes: 14,
        ringBufferCapBytes: 1024,
      },
    });
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  async function renderMenu(): Promise<void> {
    const { TerminalLogContextMenu } = await import(
      '@renderer/features/tasks/terminals/terminal-log-context-menu'
    );
    await act(async () => {
      root.render(
        createElement(TerminalLogContextMenu, {
          terminal: terminal(),
          children: createElement('span', null, 'terminal'),
        })
      );
    });
  }

  it('copies the refreshed log path and readable content', async () => {
    await renderMenu();

    await act(async () => button(host, 'tasks.terminals.copyLogPath').click());
    expect(mocks.exportTerminalLog).toHaveBeenCalledWith('project-1:task-1:terminal-1');
    expect(mocks.clipboardWriteText).toHaveBeenLastCalledWith('/tmp/terminal.log');

    await act(async () => button(host, 'tasks.terminals.copyLogContent').click());
    expect(mocks.clipboardWriteText).toHaveBeenLastCalledWith('server ready');
  });

  it('copies structured terminal handoff information with the real log path', async () => {
    await renderMenu();

    await act(async () => button(host, 'tasks.terminals.copyInfo').click());

    const copied = mocks.clipboardWriteText.mock.calls.at(-1)?.[0] as string;
    expect(copied).toContain('tasks.terminals.infoName: Dev server');
    expect(copied).toContain('tasks.terminals.infoSessionId: project-1:task-1:terminal-1');
    expect(copied).toContain('tasks.terminals.infoLogPath: /tmp/terminal.log');
  });

  it('does not overwrite the clipboard when the terminal has no output', async () => {
    mocks.exportTerminalLog.mockResolvedValue({
      success: true,
      data: {
        path: '/tmp/empty.log',
        content: '',
        capturedAt: '2026-07-31T00:00:00.000Z',
        contentBytes: 0,
        ringBufferBytes: 0,
        ringBufferCapBytes: 1024,
      },
    });
    await renderMenu();

    await act(async () => button(host, 'tasks.terminals.copyLogContent').click());

    expect(mocks.clipboardWriteText).not.toHaveBeenCalled();
    expect(mocks.toast).toHaveBeenCalledWith({ title: 'tasks.terminals.logEmpty' });
  });
});
