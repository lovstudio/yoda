import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type * as ReactI18nextModule from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TerminalLinkMenu, type TerminalLinkMenuState } from '@renderer/lib/pty/terminal-link-menu';

const mocks = vi.hoisted(() => ({
  clickThrough: vi.fn(),
  openInYoda: vi.fn<(url: string) => void>(),
  openExternal: vi.fn(async () => undefined),
  clipboardWriteText: vi.fn(async () => ({ success: true })),
  navigate: vi.fn(),
}));

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof ReactI18nextModule>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@renderer/lib/ipc', () => ({
  events: {
    on: vi.fn(() => vi.fn()),
  },
  rpc: {
    app: {
      clipboardWriteText: mocks.clipboardWriteText,
      openExternal: mocks.openExternal,
    },
  },
}));

vi.mock('@renderer/lib/stores/app-state', () => ({
  appState: {
    navigation: {
      navigate: mocks.navigate,
    },
  },
}));

vi.mock('@renderer/lib/components/file-path-actions', () => ({
  FilePathMenuItems: () => null,
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const menuState: TerminalLinkMenuState = {
  target: { kind: 'url', url: 'https://example.com' },
  x: 40,
  y: 40,
};

function MenuOverTerminal() {
  const [state, setState] = useState<TerminalLinkMenuState | null>(menuState);

  return (
    <>
      <button type="button" className="fixed inset-0" onClick={mocks.clickThrough}>
        terminal
      </button>
      <TerminalLinkMenu
        state={state}
        fileLinks={null}
        webLinks={{ onOpen: mocks.openInYoda }}
        onClose={() => setState(null)}
      />
    </>
  );
}

describe('TerminalLinkMenu', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    mocks.clickThrough.mockReset();
    mocks.openInYoda.mockReset();
    mocks.openExternal.mockClear();
    mocks.clipboardWriteText.mockClear();
    mocks.navigate.mockReset();
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => root.render(<MenuOverTerminal />));
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  it('dismisses without sending the click through to the terminal underneath', async () => {
    const dismissLayer = document.querySelector<HTMLElement>(
      '[data-terminal-link-menu-dismiss-layer]'
    );
    if (!dismissLayer) throw new Error('Terminal link menu dismiss layer is missing');

    await act(async () => dismissLayer.click());

    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(mocks.clickThrough).not.toHaveBeenCalled();
  });

  it('offers explicit internal, default-app, copy, and settings actions', () => {
    const labels = Array.from(document.querySelectorAll('[role="menuitem"]')).map((item) =>
      item.textContent?.trim()
    );

    expect(labels).toEqual([
      'terminal.linkMenu.openInYoda',
      'terminal.linkMenu.openWithDefaultApp',
      'terminal.linkMenu.copyUrl',
      'terminal.linkMenu.openSettings',
    ]);
  });

  it('opens the URL inside Yoda', async () => {
    await act(async () => clickMenuItem('terminal.linkMenu.openInYoda'));

    expect(mocks.openInYoda).toHaveBeenCalledWith('https://example.com');
    expect(mocks.openExternal).not.toHaveBeenCalled();
  });

  it('opens the URL with the system default app', async () => {
    await act(async () => clickMenuItem('terminal.linkMenu.openWithDefaultApp'));

    expect(mocks.openExternal).toHaveBeenCalledWith('https://example.com');
    expect(mocks.openInYoda).not.toHaveBeenCalled();
  });

  it('copies the URL', async () => {
    await act(async () => clickMenuItem('terminal.linkMenu.copyUrl'));

    expect(mocks.clipboardWriteText).toHaveBeenCalledWith('https://example.com');
  });

  it('opens terminal link settings', async () => {
    await act(async () => clickMenuItem('terminal.linkMenu.openSettings'));

    expect(mocks.navigate).toHaveBeenCalledWith('settings', { tab: 'terminal' });
  });
});

function clickMenuItem(label: string): void {
  const item = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')).find(
    (candidate) => candidate.textContent?.trim() === label
  );
  if (!item) throw new Error(`Terminal link menu item is missing: ${label}`);
  item.click();
}
