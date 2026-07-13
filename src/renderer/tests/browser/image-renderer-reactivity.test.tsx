import { createElement } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { FileTabStore } from '@renderer/features/tasks/tabs/file-tab-store';
import { ImageRenderer } from '@renderer/lib/editor/image-renderer';

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
  });
});
