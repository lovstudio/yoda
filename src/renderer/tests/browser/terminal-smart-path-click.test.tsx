import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TERMINAL_LINK_OPEN_CHANGED_EVENT } from '@shared/terminal-settings';
import { FrontendPty } from '@renderer/lib/pty/pty';
import { PtyPane } from '@renderer/lib/pty/pty-pane';
import type { TerminalFileLinkTarget } from '@renderer/lib/pty/terminal-file-links';

const mocks = vi.hoisted(() => ({
  openFile: vi.fn<(target: TerminalFileLinkTarget) => void>(),
  openUrl: vi.fn<(url: string) => void>(),
  openExternal: vi.fn(async () => undefined),
  openIn: vi.fn(async () => ({ success: true })),
}));

vi.mock('@renderer/lib/ipc', () => ({
  events: {
    on: vi.fn(() => vi.fn()),
  },
  rpc: {
    app: {
      clipboardWriteText: vi.fn(async () => ({ success: true })),
      openExternal: mocks.openExternal,
      openIn: mocks.openIn,
    },
    appSettings: {
      get: vi.fn(async () => ({
        autoCopyOnSelection: false,
        linkOpen: { file: 'yoda', url: 'yoda', fileRules: [] },
        scrollbackLines: 10_000,
      })),
    },
    pty: {
      resize: vi.fn(async () => undefined),
      sendInput: vi.fn(async () => ({ success: true })),
      subscribe: vi.fn(async () => ({
        success: true,
        data: { buffer: '', generation: 1, sequence: 0 },
      })),
      unsubscribe: vi.fn(async () => undefined),
      acknowledgeOutput: vi.fn(async () => undefined),
      heartbeatConsumer: vi.fn(async () => undefined),
    },
  },
}));

vi.mock('@renderer/lib/pty/terminal-link-menu', () => ({
  TerminalLinkMenu: () => null,
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function writeTerminal(pty: FrontendPty, data: string): Promise<void> {
  return new Promise((resolve) => pty.terminal.write(data, resolve));
}

describe('terminal link primary click', () => {
  const sessionId = 'terminal-smart-path-click';
  let host: HTMLDivElement;
  let root: Root;
  let pty: FrontendPty;

  beforeEach(async () => {
    mocks.openFile.mockReset();
    mocks.openUrl.mockReset();
    mocks.openExternal.mockClear();
    mocks.openIn.mockClear();
    host = document.createElement('div');
    Object.assign(host.style, { width: '1000px', height: '400px' });
    document.body.appendChild(host);
    root = createRoot(host);
    pty = new FrontendPty(sessionId);
    pty.flushPendingWrites();

    await act(async () => {
      root.render(
        <PtyPane
          sessionId={sessionId}
          pty={pty}
          fileLinks={{
            workspaceRoot: '/repo',
            onOpen: mocks.openFile,
          }}
          webLinks={{ onOpen: mocks.openUrl }}
        />
      );
    });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    pty.dispose();
    host.remove();
  });

  it('opens a recognized source location on an ordinary left click', async () => {
    const path = 'src/renderer/features/tasks/conversations/conversations-panel.tsx:223:9';
    await writeTerminal(pty, path);

    const screen = host.querySelector<HTMLElement>('.xterm-screen');
    if (!screen) throw new Error('xterm screen was not mounted');
    const rect = screen.getBoundingClientRect();
    const cellWidth = rect.width / pty.terminal.cols;
    const cellHeight = rect.height / pty.terminal.rows;
    const mouseDown = new MouseEvent('mousedown', {
      bubbles: true,
      cancelable: true,
      button: 0,
      buttons: 1,
      clientX: rect.left + cellWidth * 10.5,
      clientY: rect.top + cellHeight * 0.5,
    });

    screen.dispatchEvent(mouseDown);

    expect(mouseDown.defaultPrevented).toBe(true);
    expect(mocks.openFile).toHaveBeenCalledWith({
      originalText: path,
      filePath: 'src/renderer/features/tasks/conversations/conversations-panel.tsx',
      absolutePath: '/repo/src/renderer/features/tasks/conversations/conversations-panel.tsx',
      line: 223,
      column: 9,
    });
  });

  it('keeps a local absolute file inside Yoda when the preference is internal', async () => {
    const path = '/Users/mark/Documents/report.md:12';
    await writeTerminal(pty, path);

    const screen = host.querySelector<HTMLElement>('.xterm-screen');
    if (!screen) throw new Error('xterm screen was not mounted');
    const rect = screen.getBoundingClientRect();
    const cellWidth = rect.width / pty.terminal.cols;
    const cellHeight = rect.height / pty.terminal.rows;
    const mouseDown = new MouseEvent('mousedown', {
      bubbles: true,
      cancelable: true,
      button: 0,
      buttons: 1,
      clientX: rect.left + cellWidth * 10.5,
      clientY: rect.top + cellHeight * 0.5,
    });

    screen.dispatchEvent(mouseDown);

    expect(mouseDown.defaultPrevented).toBe(true);
    expect(mocks.openFile).toHaveBeenCalledWith({
      originalText: path,
      absolutePath: '/Users/mark/Documents/report.md',
      line: 12,
    });
    expect(mocks.openExternal).not.toHaveBeenCalled();
  });

  it('opens a URL from a replayed conversation on an ordinary left click', async () => {
    const url = 'https://tolkiengateway.net/wiki/Portal%3AImages';
    const line = `Tolkien Gateway (${url})`;
    await writeTerminal(pty, line);

    const screen = host.querySelector<HTMLElement>('.xterm-screen');
    if (!screen) throw new Error('xterm screen was not mounted');
    const rect = screen.getBoundingClientRect();
    const cellWidth = rect.width / pty.terminal.cols;
    const cellHeight = rect.height / pty.terminal.rows;
    const mouseDown = new MouseEvent('mousedown', {
      bubbles: true,
      cancelable: true,
      button: 0,
      buttons: 1,
      clientX: rect.left + cellWidth * (line.indexOf(url) + 8.5),
      clientY: rect.top + cellHeight * 0.5,
    });

    screen.dispatchEvent(mouseDown);

    expect(mouseDown.defaultPrevented).toBe(true);
    expect(mocks.openUrl).toHaveBeenCalledWith(url);
  });

  it('sends a URL to the system browser when the URL handler is system', async () => {
    const url = 'https://lovstudio.ai/about';
    await writeTerminal(pty, url);
    window.dispatchEvent(
      new CustomEvent(TERMINAL_LINK_OPEN_CHANGED_EVENT, {
        detail: { file: 'yoda', url: 'system', fileRules: [] },
      })
    );

    const screen = host.querySelector<HTMLElement>('.xterm-screen');
    if (!screen) throw new Error('xterm screen was not mounted');
    const rect = screen.getBoundingClientRect();
    const cellWidth = rect.width / pty.terminal.cols;
    const cellHeight = rect.height / pty.terminal.rows;
    const mouseDown = new MouseEvent('mousedown', {
      bubbles: true,
      cancelable: true,
      button: 0,
      buttons: 1,
      clientX: rect.left + cellWidth * 8.5,
      clientY: rect.top + cellHeight * 0.5,
    });

    screen.dispatchEvent(mouseDown);

    expect(mouseDown.defaultPrevented).toBe(true);
    expect(mocks.openExternal).toHaveBeenCalledWith(url);
    expect(mocks.openUrl).not.toHaveBeenCalled();
  });

  it('routes a file matching a per-format rule to an external app', async () => {
    const path = '/Users/mark/Documents/shot.png';
    await writeTerminal(pty, path);
    window.dispatchEvent(
      new CustomEvent(TERMINAL_LINK_OPEN_CHANGED_EVENT, {
        detail: {
          file: 'yoda',
          url: 'yoda',
          fileRules: [{ extensions: ['png'], handler: 'system' }],
        },
      })
    );

    const screen = host.querySelector<HTMLElement>('.xterm-screen');
    if (!screen) throw new Error('xterm screen was not mounted');
    const rect = screen.getBoundingClientRect();
    const cellWidth = rect.width / pty.terminal.cols;
    const cellHeight = rect.height / pty.terminal.rows;
    const mouseDown = new MouseEvent('mousedown', {
      bubbles: true,
      cancelable: true,
      button: 0,
      buttons: 1,
      clientX: rect.left + cellWidth * 10.5,
      clientY: rect.top + cellHeight * 0.5,
    });

    screen.dispatchEvent(mouseDown);

    expect(mouseDown.defaultPrevented).toBe(true);
    // No line number, so the system default handler is Finder-without-reveal.
    expect(mocks.openIn).toHaveBeenCalledWith(
      expect.objectContaining({ app: 'finder', path, reveal: false })
    );
    expect(mocks.openFile).not.toHaveBeenCalled();
  });
});
