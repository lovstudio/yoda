import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { MarkdownRenderer } from './markdown-renderer';

vi.mock('@renderer/lib/hooks/useTheme', () => ({
  useTheme: () => ({ effectiveTheme: 'ylight' }),
}));

vi.mock('@renderer/lib/ipc', () => ({
  rpc: {
    app: {
      openExternal: vi.fn(),
    },
  },
}));

describe('MarkdownRenderer', () => {
  it('renders GFM tables in compact mode with a horizontal scroll container', () => {
    const html = renderToStaticMarkup(
      React.createElement(MarkdownRenderer, {
        content: [
          '| File | Status |',
          '| --- | ---: |',
          '| src/renderer/app/home-view.tsx | fixed |',
        ].join('\n'),
        variant: 'compact',
      })
    );

    expect(html).toContain('<table');
    expect(html).toContain('<thead');
    expect(html).toContain('overflow-x-auto');
    expect(html).toContain('min-w-full');
    expect(html).toContain('text-align:right');
  });
});
