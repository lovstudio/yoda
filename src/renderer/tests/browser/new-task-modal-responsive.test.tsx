import { act, createElement, type ComponentProps, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import '../../index.css';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type ChildrenProps = {
  children?: ReactNode;
  className?: string;
};

function chip(label: string, width: number): ReactNode {
  return createElement(
    'button',
    {
      type: 'button',
      style: {
        alignItems: 'center',
        border: '1px solid currentColor',
        borderRadius: 7,
        display: 'flex',
        flex: '0 0 auto',
        height: 28,
        justifyContent: 'center',
        padding: '0 10px',
        width,
      },
    },
    label
  );
}

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@renderer/lib/ui/dialog', () => ({
  DialogContentArea: ({ children, className }: ChildrenProps) =>
    createElement('div', { 'data-slot': 'dialog-content-area', className }, children),
  DialogHeader: ({ children, className }: ChildrenProps) =>
    createElement('div', { 'data-slot': 'dialog-header', className }, children),
  DialogTitle: ({ children, className }: ChildrenProps) =>
    createElement('h2', { 'data-slot': 'dialog-title', className }, children),
}));

vi.mock('@renderer/app/home-view', () => ({
  HomeComposer: (_props: ComponentProps<'div'>) =>
    createElement(
      'div',
      { 'data-yoda-surface': 'home-composer' },
      createElement(
        'div',
        { 'data-yoda-surface': 'home-composer-input' },
        createElement(
          'div',
          {
            'data-yoda-surface': 'composer',
            style: { border: '1px solid currentColor', display: 'flex', flexDirection: 'column' },
          },
          createElement('textarea', {
            'aria-label': '任务描述',
            'data-slot': 'textarea',
            style: { boxSizing: 'border-box', resize: 'none', width: '100%' },
          })
        )
      ),
      createElement(
        'div',
        { 'data-yoda-surface': 'home-composer-toolbar', style: { marginTop: 12 } },
        createElement(
          'div',
          {
            style: {
              alignItems: 'center',
              display: 'flex',
              flexWrap: 'wrap',
              gap: 8,
              width: '100%',
            },
          },
          chip('项目', 96),
          chip('环境', 88),
          chip('分支', 128),
          chip('代理', 132),
          createElement(
            'div',
            {
              'data-yoda-surface': 'home-composer-actions',
              className: 'ml-auto flex items-center gap-2',
              style: {
                alignItems: 'center',
                display: 'flex',
                gap: 8,
                marginLeft: 'auto',
              },
            },
            chip('配置', 72),
            chip('对比', 72)
          )
        )
      )
    ),
}));

function rect(element: Element | null): DOMRect {
  if (!(element instanceof HTMLElement)) throw new Error('Expected an HTMLElement');
  return element.getBoundingClientRect();
}

describe('NewTaskModal responsive layout', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement('div');
    Object.assign(host.style, {
      boxSizing: 'border-box',
      height: '100%',
      overflow: 'auto',
    });
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    await page.viewport(1280, 720);
  });

  async function renderAt(width: number, height: number): Promise<void> {
    await page.viewport(width, height);
    host.style.width = `${width}px`;
    const { NewTaskModal } = await import('@renderer/app/new-task-modal');
    await act(async () => {
      root.render(createElement(NewTaskModal, { onClose: vi.fn(), onSuccess: vi.fn() }));
    });
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  }

  it('keeps settings and compare together when the toolbar wraps', async () => {
    await renderAt(480, 500);

    const modal = host.querySelector('[data-yoda-surface="new-task-modal"]');
    const content = host.querySelector('[data-slot="dialog-content-area"]');
    const toolbar = host.querySelector('[data-yoda-surface="home-composer-toolbar"]');
    const actionGroup = host.querySelector('[data-yoda-surface="home-composer-actions"]');
    const buttons = actionGroup?.querySelectorAll('button');

    expect(getComputedStyle(modal as Element).containerType).toBe('inline-size');
    expect(getComputedStyle(content as Element).paddingLeft).toBe('16px');
    expect(rect(actionGroup).width).toBeCloseTo(rect(toolbar).width, 0);
    expect(rect(buttons?.item(1) ?? null).left - rect(buttons?.item(0) ?? null).right).toBeCloseTo(
      8,
      0
    );
    expect((content as HTMLElement).scrollWidth).toBeLessThanOrEqual(
      (content as HTMLElement).clientWidth
    );
  });

  it('keeps the desktop capture tray compact', async () => {
    await renderAt(900, 700);

    const content = host.querySelector('[data-slot="dialog-content-area"]');
    const toolbar = host.querySelector('[data-yoda-surface="home-composer-toolbar"]');
    const actionGroup = host.querySelector('[data-yoda-surface="home-composer-actions"]');
    const textarea = host.querySelector('[data-slot="textarea"]');

    expect(getComputedStyle(content as Element).paddingLeft).toBe('20px');
    expect(rect(actionGroup).width).toBeLessThan(rect(toolbar).width);
    expect(Number.parseFloat(getComputedStyle(textarea as Element).minHeight)).toBeCloseTo(112, 0);
  });

  it('compresses the prompt at low viewport heights', async () => {
    await renderAt(720, 480);

    const textarea = host.querySelector('[data-slot="textarea"]');
    const textareaStyle = getComputedStyle(textarea as Element);

    expect(Number.parseFloat(textareaStyle.minHeight)).toBeCloseTo(72, 0);
    expect(Number.parseFloat(textareaStyle.maxHeight)).toBeLessThanOrEqual(106);
  });
});
