/**
 * Browser-mode tests for the markdown annotation selection detector.
 *
 * Runs in real Chromium via Playwright so the Selection/Range APIs behave like
 * production — the bit that decides whether a floating "add note" action shows.
 */
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import Markdown from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';
import type { PluggableList } from 'unified';
import { afterEach, describe, expect, it } from 'vitest';
import { detectSelectionInside, sourceLineAttr } from '@renderer/lib/ui/markdown-annotations';

function appendText(parent: HTMLElement, text: string): HTMLElement {
  const el = document.createElement('p');
  el.textContent = text;
  parent.appendChild(el);
  return el;
}

function selectNodeContents(node: Node): void {
  const range = document.createRange();
  range.selectNodeContents(node);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

describe('detectSelectionInside', () => {
  let container: HTMLDivElement;

  afterEach(() => {
    window.getSelection()?.removeAllRanges();
    container?.remove();
  });

  it('returns the quote when the selection is inside the container', () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    const p = appendText(container, 'hello annotated world');

    selectNodeContents(p);

    const result = detectSelectionInside(container);
    expect(result).not.toBeNull();
    expect(result?.quote).toBe('hello annotated world');
  });

  it('collapses whitespace/newlines in the quote', () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    const p = appendText(container, '  line one\n   line two  ');

    selectNodeContents(p);

    expect(detectSelectionInside(container)?.quote).toBe('line one line two');
  });

  it('returns null when there is no selection', () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    appendText(container, 'nothing selected');

    expect(detectSelectionInside(container)).toBeNull();
  });

  it('returns null when the selection lives outside the container', () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    appendText(container, 'inside');

    const outside = document.createElement('div');
    document.body.appendChild(outside);
    const p = appendText(outside, 'outside selection');
    selectNodeContents(p);

    expect(detectSelectionInside(container)).toBeNull();
    outside.remove();
  });

  it('detects selection even when the container has role="button" (click-to-edit wrapper)', () => {
    container = document.createElement('div');
    container.setAttribute('role', 'button');
    container.tabIndex = 0;
    document.body.appendChild(container);
    const p = appendText(container, 'summary text in a button-role wrapper');

    selectNodeContents(p);

    expect(detectSelectionInside(container)?.quote).toBe('summary text in a button-role wrapper');
  });

  it('reads the source line from the nearest [data-source-line] ancestor', () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    const p = document.createElement('p');
    p.setAttribute('data-source-line', '42');
    p.textContent = 'a quoted line';
    container.appendChild(p);

    selectNodeContents(p.firstChild as Node);

    expect(detectSelectionInside(container)?.line).toBe(42);
  });
});

describe('sourceLineAttr through the real markdown pipeline', () => {
  const hosts: HTMLDivElement[] = [];

  afterEach(() => {
    while (hosts.length) hosts.pop()?.remove();
  });

  async function renderMarkdown(rehypePlugins: PluggableList): Promise<HTMLDivElement> {
    const host = document.createElement('div');
    document.body.appendChild(host);
    hosts.push(host);
    const markdown = 'first paragraph\n\nsecond paragraph\n\nthird paragraph';
    const root = createRoot(host);
    root.render(
      createElement(
        Markdown,
        {
          remarkPlugins: [remarkGfm],
          rehypePlugins,
          components: {
            p: ({ children, node }: { children?: React.ReactNode; node?: unknown }) =>
              createElement(
                'p',
                sourceLineAttr(node as Parameters<typeof sourceLineAttr>[0]),
                children
              ),
          },
        },
        markdown
      )
    );
    // Poll until React commits the paragraphs before inspecting the DOM.
    for (let i = 0; i < 50 && host.querySelectorAll('p').length < 3; i++) {
      await new Promise<void>((r) => requestAnimationFrame(() => r()));
    }
    return host;
  }

  // Guards the anchor feature: if positions stopped surviving the rehype
  // pipeline, every annotation would silently lose its line number.
  it('emits data-source-line for the full variant pipeline (rehypeRaw + sanitize)', async () => {
    const host = await renderMarkdown([rehypeRaw, rehypeSanitize]);
    const lines = [...host.querySelectorAll('p')].map((p) => p.getAttribute('data-source-line'));
    expect(host.querySelectorAll('p').length).toBe(3);
    expect(lines).toEqual(['1', '3', '5']);
  });

  it('emits data-source-line for the compact variant pipeline (sanitize only)', async () => {
    const host = await renderMarkdown([rehypeSanitize]);
    const lines = [...host.querySelectorAll('p')].map((p) => p.getAttribute('data-source-line'));
    expect(lines).toEqual(['1', '3', '5']);
  });
});
