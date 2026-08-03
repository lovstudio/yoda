import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FrontendPty } from '@renderer/lib/pty/pty';
import { PtyPane } from '@renderer/lib/pty/pty-pane';

const mocks = vi.hoisted(() => ({
  sendInput: vi.fn<(sessionId: string, data: string) => Promise<{ success: true }>>(),
  getPathForFile: vi.fn<(file: File) => string>(),
}));

vi.mock('@renderer/lib/ipc', () => ({
  events: {
    on: vi.fn(() => vi.fn()),
  },
  rpc: {
    app: {
      clipboardWriteText: vi.fn(async () => ({ success: true })),
      openExternal: vi.fn(async () => undefined),
    },
    appSettings: {
      get: vi.fn(async () => ({
        autoCopyOnSelection: false,
        scrollbackLines: 10_000,
      })),
    },
    fs: {
      saveClipboardImage: vi.fn(async () => ({
        success: true,
        data: { absPath: '/tmp/saved-clipboard.png' },
      })),
    },
    pty: {
      resize: vi.fn(async () => undefined),
      sendInput: mocks.sendInput,
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

async function waitForTerminalInput(): Promise<string> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const input = mocks.sendInput.mock.calls.at(-1)?.[1];
    if (input) return input;
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  }
  throw new Error('Terminal did not forward pasted input');
}

function writeTerminal(pty: FrontendPty, data: string): Promise<void> {
  return new Promise((resolve) => pty.terminal.write(data, resolve));
}

describe('active TUI interactions', () => {
  let host: HTMLDivElement;
  let root: Root;
  let pty: FrontendPty;

  beforeEach(async () => {
    mocks.sendInput.mockReset().mockResolvedValue({ success: true });
    mocks.getPathForFile.mockReset().mockImplementation((file) => `/tmp/${file.name}`);
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: { getPathForFile: mocks.getPathForFile },
    });

    host = document.createElement('div');
    Object.assign(host.style, { width: '800px', height: '400px' });
    document.body.appendChild(host);
    root = createRoot(host);
    pty = new FrontendPty('terminal-image-path-paste');
    pty.flushPendingWrites();

    await act(async () => {
      root.render(<PtyPane sessionId="terminal-image-path-paste" pty={pty} pasteImagesAsPaths />);
    });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    pty.dispose();
    host.remove();
    Reflect.deleteProperty(window, 'electronAPI');
  });

  it('wraps pasted image path text and image files before PTY input', async () => {
    const textarea = host.querySelector<HTMLTextAreaElement>('.xterm-helper-textarea');
    if (!textarea) throw new Error('xterm paste target was not mounted');

    const pathClipboard = new DataTransfer();
    pathClipboard.setData('text/plain', '/tmp/reference image.png');
    textarea.dispatchEvent(
      new ClipboardEvent('paste', {
        bubbles: true,
        cancelable: true,
        clipboardData: pathClipboard,
      })
    );
    expect(await waitForTerminalInput()).toContain('`@/tmp/reference image.png`');

    mocks.sendInput.mockClear();
    const fileClipboard = new DataTransfer();
    fileClipboard.items.add(new File(['image'], 'clipboard.png', { type: 'image/png' }));
    textarea.dispatchEvent(
      new ClipboardEvent('paste', {
        bubbles: true,
        cancelable: true,
        clipboardData: fileClipboard,
      })
    );
    expect(await waitForTerminalInput()).toContain('`@/tmp/clipboard.png`');

    // xterm owns focus on mouse down. The pane must not focus its helper
    // textarea again during mouse down or click: immediately after an image
    // paste, repeated focus transitions can crash Electron's renderer.
    const focus = vi.spyOn(pty.terminal, 'focus');
    const terminalElement = host.querySelector<HTMLElement>('.xterm');
    if (!terminalElement) throw new Error('xterm element was not mounted');

    terminalElement.dispatchEvent(
      new MouseEvent('mousedown', { bubbles: true, button: 0, buttons: 1, cancelable: true })
    );
    terminalElement.dispatchEvent(
      new MouseEvent('click', { bubbles: true, button: 0, buttons: 0, cancelable: true })
    );

    expect(focus).toHaveBeenCalledTimes(1);
  });

  it('does not forward a secondary-button press to TUI mouse tracking', async () => {
    await writeTerminal(pty, '\x1b[?1002h\x1b[?1006h');
    mocks.sendInput.mockClear();

    const screen = host.querySelector<HTMLElement>('.xterm-screen');
    if (!screen) throw new Error('xterm screen was not mounted');
    const rect = screen.getBoundingClientRect();
    const mouseDown = new MouseEvent('mousedown', {
      bubbles: true,
      cancelable: true,
      button: 2,
      buttons: 2,
      clientX: rect.left + 10,
      clientY: rect.top + 10,
    });
    const mouseUp = new MouseEvent('mouseup', {
      bubbles: true,
      cancelable: true,
      button: 2,
      buttons: 0,
      clientX: rect.left + 10,
      clientY: rect.top + 10,
    });
    const contextMenu = new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      button: 2,
      clientX: rect.left + 10,
      clientY: rect.top + 10,
    });

    screen.dispatchEvent(mouseDown);
    screen.dispatchEvent(mouseUp);
    screen.dispatchEvent(contextMenu);
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

    expect(mouseDown.defaultPrevented).toBe(true);
    expect(mouseUp.defaultPrevented).toBe(true);
    expect(contextMenu.defaultPrevented).toBe(true);
    expect(mocks.sendInput).not.toHaveBeenCalled();
  });
});
