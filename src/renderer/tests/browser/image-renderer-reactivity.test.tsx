import { createElement } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FileTabStore } from '@renderer/features/tasks/tabs/file-tab-store';
import { ImageRenderer } from '@renderer/lib/editor/image-renderer';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

async function waitForImageSource(host: HTMLElement, source: string): Promise<void> {
  for (let i = 0; i < 50; i++) {
    if (host.querySelector('img')?.getAttribute('src') === source) return;
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  }
}

describe('ImageRenderer reactivity', () => {
  let host: HTMLDivElement | undefined;
  let root: Root | undefined;

  afterEach(() => {
    root?.unmount();
    host?.remove();
  });

  it('renders image content when the file store finishes loading asynchronously', async () => {
    const file = new FileTabStore('photos/example.png', false);
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    flushSync(() => root?.render(createElement(ImageRenderer, { file })));

    expect(host.querySelector('img')).toBeNull();

    const dataUrl = 'data:image/png;base64,aW1hZ2U=';
    file.setImageContent(dataUrl);

    await waitForImageSource(host, dataUrl);
    expect(host.querySelector('img')?.getAttribute('src')).toBe(dataUrl);
    expect(host.querySelector('.yoda-image-viewer')).not.toBeNull();
    expect(host.querySelector('button[aria-label="editor.imageViewer.download"]')).not.toBeNull();
    expect(
      host.querySelector('button[aria-label="editor.imageViewer.enterFullscreen"]')
    ).not.toBeNull();
    expect(host.querySelector('button[aria-label="editor.imageViewer.zoomIn"]')).not.toBeNull();
    expect(host.querySelector('button[aria-label="editor.imageViewer.zoomOut"]')).not.toBeNull();
  });
});
