import { act, Activity } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@renderer/lib/ipc', () => ({
  rpc: { app: { openExternal: vi.fn() } },
}));

vi.mock('@renderer/lib/clipboard', () => ({
  copyText: vi.fn(),
}));

const { BrowserPane } = await import('@renderer/features/tasks/browser/browser-pane');
const { TaskBrowserStore } = await import('@renderer/features/tasks/browser/browser-store');

/**
 * Stand in for Electron's <webview>. `loadURL` can be made to fail the way the
 * real one does before its guest attaches (a synchronous throw).
 */
function stubWebview(host: HTMLElement) {
  const el = host.querySelector('webview') as (HTMLElement & Record<string, unknown>) | null;
  if (el === null) throw new Error('no webview mounted');
  const loaded: string[] = [];
  let failNext = false;
  const loadURL = vi.fn(async (url: string) => {
    if (failNext) {
      failNext = false;
      throw new Error('The WebView must be attached to the DOM');
    }
    loaded.push(url);
  });
  Object.assign(el, {
    loadURL,
    getURL: () => loaded.at(-1) ?? 'stub://initial',
    canGoBack: () => false,
    canGoForward: () => false,
    isCurrentlyAudible: () => false,
    setAudioMuted: () => undefined,
  });
  return {
    el,
    loaded,
    failNextLoad: () => {
      failNext = true;
    },
    domReady: () => el.dispatchEvent(new Event('dom-ready')),
  };
}

async function submitAddress(host: HTMLElement, value: string) {
  const input = host.querySelector('input[aria-label]') as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  setter.call(input, value);
  await act(async () => {
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  });
}

describe('BrowserPane address bar', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  const mount = async (url: string | null) => {
    const store = new TaskBrowserStore({ url, title: '', history: [] });
    await act(async () => {
      root.render(
        <Activity mode="visible">
          <BrowserPane store={store} />
        </Activity>
      );
    });
    return store;
  };

  it('mounts the webview with the URL submitted from the empty state', async () => {
    const store = await mount(null);
    expect(host.querySelector('webview')).toBeNull();

    await submitAddress(host, 'c.example');

    expect(store.url).toBe('https://c.example');
    expect(host.querySelector('webview')?.getAttribute('src')).toBe('https://c.example');
  });

  it('loads a newly submitted URL into the mounted webview', async () => {
    await mount('https://a.example');
    const webview = stubWebview(host);

    await submitAddress(host, 'b.example');

    expect(webview.loaded).toEqual(['https://b.example']);
  });

  // Regression: the load used to be gated on "URL differs from the last one we
  // asked for", so a failed load poisoned that URL forever — resubmitting it
  // (or pressing Enter to reload) silently did nothing.
  it('reloads when the same URL is submitted again', async () => {
    await mount('https://a.example');
    const webview = stubWebview(host);

    await submitAddress(host, 'e.example');
    await submitAddress(host, 'e.example');

    expect(webview.loaded).toEqual(['https://e.example', 'https://e.example']);
  });

  it('retries on dom-ready when the guest is not attached yet', async () => {
    await mount('https://a.example');
    const webview = stubWebview(host);
    webview.failNextLoad();

    await submitAddress(host, 'f.example');
    expect(webview.loaded).toEqual([]);

    await act(async () => webview.domReady());
    expect(webview.loaded).toEqual(['https://f.example']);
  });

  it('keeps loading submitted URLs after the pane was hidden and shown again', async () => {
    const store = new TaskBrowserStore({ url: 'https://a.example', title: '', history: [] });
    const render = (mode: 'visible' | 'hidden') =>
      root.render(
        <Activity mode={mode}>
          <BrowserPane store={store} visible={mode === 'visible'} />
        </Activity>
      );
    await act(async () => render('visible'));
    await act(async () => render('hidden'));
    await act(async () => render('visible'));
    const webview = stubWebview(host);

    await submitAddress(host, 'd.example');

    expect(webview.loaded).toEqual(['https://d.example']);
  });
});
