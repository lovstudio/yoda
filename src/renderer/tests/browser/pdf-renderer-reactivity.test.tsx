import { createElement } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { FileTabStore } from '@renderer/features/tasks/tabs/file-tab-store';
import { PdfRenderer } from '@renderer/lib/editor/pdf-renderer';

async function waitForPdfSource(host: HTMLElement, source: string): Promise<void> {
  for (let i = 0; i < 50; i++) {
    if (host.querySelector('embed[type="application/pdf"]')?.getAttribute('src') === source) return;
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  }
}

describe('PdfRenderer reactivity', () => {
  let host: HTMLDivElement | undefined;
  let root: Root | undefined;

  afterEach(() => {
    root?.unmount();
    host?.remove();
  });

  it('renders PDF content when the file store finishes loading asynchronously', async () => {
    const file = new FileTabStore('reports/example.pdf', false);
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    flushSync(() => root?.render(createElement(PdfRenderer, { file })));

    expect(host.querySelector('embed[type="application/pdf"]')).toBeNull();

    const dataUrl = 'data:application/pdf;base64,JVBERi0xLjQKJSVFT0Y=';
    file.setImageContent(dataUrl);

    await waitForPdfSource(host, dataUrl);
    expect(host.querySelector('embed[type="application/pdf"]')?.getAttribute('src')).toBe(dataUrl);
  });
});
