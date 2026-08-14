import { act, createElement, Fragment } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SessionOpeningSurface } from '@renderer/features/tasks/components/session-opening-surface';
import '../../index.css';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const loadingProps = {
  heading: 'Opening session...',
  description: 'Opening session...',
  progressMessage: 'Opening session...',
};

describe('SessionOpeningSurface', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    document.documentElement.classList.add('ylight');
    host = document.createElement('div');
    host.style.width = '640px';
    host.style.height = '400px';
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    document.documentElement.classList.remove('ylight', 'ydark');
  });

  it('renders one accessible pure mark without visible loading copy or a generic spinner', async () => {
    await act(async () => {
      root.render(createElement(SessionOpeningSurface, loadingProps));
    });

    const surface = host.querySelector<HTMLElement>('[data-session-opening-presentation="brand"]');
    expect(surface).not.toBeNull();
    expect(surface?.getAttribute('role')).toBe('status');
    expect(surface?.getAttribute('aria-live')).toBe('polite');
    expect(surface?.getAttribute('aria-busy')).toBe('true');
    expect(surface?.getAttribute('aria-label')).toBe(loadingProps.progressMessage);
    expect(surface?.textContent).toBe('');
    expect(surface?.querySelector('p, header, footer')).toBeNull();

    const marks = surface?.querySelectorAll<SVGSVGElement>('[data-yoda-opening-mark]');
    expect(marks).toHaveLength(1);
    const mark = marks?.[0];
    expect(mark?.getAttribute('viewBox')).toBe('0 0 240 220');
    expect(mark?.getAttribute('aria-hidden')).toBe('true');
    expect(mark?.getAttribute('focusable')).toBe('false');
    expect(mark?.querySelectorAll('circle')).toHaveLength(2);
    expect(mark?.querySelector('path[fill="currentColor"]')).not.toBeNull();
    expect(mark?.querySelector('text, image')).toBeNull();

    expect(surface?.querySelectorAll('svg')).toHaveLength(1);
    expect(surface?.querySelector('.lucide-loader-circle, .lucide-loader-2')).toBeNull();
  });

  it('uses unique mask and gradient definitions for concurrently mounted marks', async () => {
    await act(async () => {
      root.render(
        createElement(
          Fragment,
          null,
          createElement(SessionOpeningSurface, {
            ...loadingProps,
            surface: 'first-session-opening',
          }),
          createElement(SessionOpeningSurface, {
            ...loadingProps,
            surface: 'second-session-opening',
          })
        )
      );
    });

    const marks = Array.from(host.querySelectorAll<SVGSVGElement>('[data-yoda-opening-mark]'));
    expect(marks).toHaveLength(2);

    const maskIds = marks.map((mark) => mark.querySelector('mask')?.id);
    const gradientIds = marks.map((mark) => mark.querySelector('radialGradient')?.id);
    expect(maskIds.every(Boolean)).toBe(true);
    expect(gradientIds.every(Boolean)).toBe(true);
    expect(new Set(maskIds).size).toBe(2);
    expect(new Set(gradientIds).size).toBe(2);

    marks.forEach((mark, index) => {
      expect(mark.querySelector('path[mask]')?.getAttribute('mask')).toBe(
        `url(#${maskIds[index]})`
      );
      expect(mark.querySelector('circle[fill^="url"]')?.getAttribute('fill')).toBe(
        `url(#${gradientIds[index]})`
      );
    });
  });

  it('keeps heading, description, and actions visible in the detail presentation', async () => {
    await act(async () => {
      root.render(
        createElement(SessionOpeningSurface, {
          presentation: 'detail',
          heading: 'Session failed to open',
          description: 'The terminal did not become ready.',
          progressMessage: 'The terminal did not become ready.',
          actions: createElement('button', { type: 'button' }, 'Retry'),
        })
      );
    });

    const surface = host.querySelector<HTMLElement>('[role="status"]');
    expect(surface).not.toBeNull();
    expect(surface?.querySelector('[data-yoda-opening-mark]')).toBeNull();
    expect(surface?.textContent).toContain('Session failed to open');
    expect(surface?.textContent).toContain('The terminal did not become ready.');

    const heading = Array.from(surface?.querySelectorAll<HTMLElement>('span') ?? []).find(
      (element) => element.textContent === 'Session failed to open'
    );
    const description = Array.from(surface?.querySelectorAll<HTMLParagraphElement>('p') ?? []).find(
      (element) => element.textContent?.includes('The terminal did not become ready.')
    );
    expect(heading?.checkVisibility()).toBe(true);
    expect(description?.checkVisibility()).toBe(true);

    const action = surface?.querySelector<HTMLButtonElement>('button');
    expect(action?.textContent).toBe('Retry');
    expect(action?.checkVisibility()).toBe(true);
  });
});
