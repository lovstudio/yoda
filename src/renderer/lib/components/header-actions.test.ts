import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { HeaderActionButton, HeaderActionToolbar } from './header-actions';

describe('header actions', () => {
  it('keeps peer actions icon-sized and accessibly named', () => {
    const html = renderToStaticMarkup(
      createElement(HeaderActionToolbar, {
        label: 'App actions',
        children: createElement(HeaderActionButton, {
          label: 'Pin app',
          children: createElement('svg', { 'aria-hidden': true }),
        }),
      })
    );

    expect(html).toContain('role="toolbar"');
    expect(html).toContain('aria-label="App actions"');
    expect(html).toContain('aria-label="Pin app"');
    expect(html).toContain('size-8');
  });
});
