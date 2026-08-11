import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import '../../index.css';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type ChildrenProps = {
  children?: ReactNode;
  className?: string;
};

type MockHomeComposerProps = {
  onProjectRevealed?: (projectId: string) => void;
};

function chip(
  label: string,
  width: number,
  options: {
    marginLeft?: string;
    surface?: string;
  } = {}
): ReactNode {
  return createElement(
    'button',
    {
      'data-yoda-surface': options.surface,
      type: 'button',
      style: {
        alignItems: 'center',
        border: '1px solid currentColor',
        borderRadius: 7,
        display: 'flex',
        flex: '0 0 auto',
        fontSize: 12,
        gap: 6,
        height: 28,
        justifyContent: 'center',
        marginLeft: options.marginLeft,
        padding: '0 10px',
      },
    },
    createElement('svg', {
      'aria-hidden': true,
      height: 14,
      style: { flex: '0 0 auto' },
      width: 14,
    }),
    createElement(
      'span',
      { style: { whiteSpace: 'nowrap', width: Math.max(0, width - 42) } },
      label
    )
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

vi.mock('@renderer/features/tasks/stores/task-selectors', () => ({
  getTaskStore: () => undefined,
  taskDisplayName: () => '测试任务',
}));

vi.mock('@renderer/app/home-view', () => ({
  HomeComposer: ({ onProjectRevealed }: MockHomeComposerProps) =>
    createElement(
      'div',
      { 'data-yoda-surface': 'home-composer' },
      createElement(
        'button',
        {
          'data-slot': 'mock-reveal-project',
          onClick: () => onProjectRevealed?.('project-1'),
          style: { position: 'absolute' },
          type: 'button',
        },
        '定位项目'
      ),
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
          chip('环境 · 本机 · main · 新开分支', 220),
          chip('代理', 172),
          chip('配置', 64, { surface: 'home-composer-session-settings' }),
          chip('对比', 64, {
            marginLeft: 'auto',
            surface: 'home-composer-compare-action',
          })
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

  async function renderAt(
    width: number,
    height: number,
    onClose: () => void = vi.fn()
  ): Promise<void> {
    await page.viewport(width, height);
    host.style.width = `${width}px`;
    const { NewTaskModal } = await import('@renderer/app/new-task-modal');
    await act(async () => {
      root.render(createElement(NewTaskModal, { onClose, onSuccess: vi.fn() }));
    });
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  }

  async function renderConversationAt(width: number, height: number): Promise<void> {
    await page.viewport(width, height);
    host.className = 'ydream';
    host.style.width = `${width}px`;
    const { NewConversationModal } = await import('@renderer/app/new-conversation-modal');
    await act(async () => {
      root.render(
        createElement(NewConversationModal, {
          onClose: vi.fn(),
          onSuccess: vi.fn(),
          projectId: 'project-1',
          taskId: 'task-1',
        })
      );
    });
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  }

  it('keeps the floating modal open after locating the selected project', async () => {
    const onClose = vi.fn();
    await renderAt(720, 600, onClose);

    const revealProject = host.querySelector<HTMLButtonElement>(
      'button[data-slot="mock-reveal-project"]'
    );
    if (!revealProject) throw new Error('Reveal-project action is missing');
    await act(async () => revealProject.click());

    expect(onClose).not.toHaveBeenCalled();
  });

  it('keeps session settings separate from the compare action when the toolbar wraps', async () => {
    await renderAt(480, 500);

    const modal = host.querySelector('[data-yoda-surface="new-task-modal"]');
    const content = host.querySelector('[data-slot="dialog-content-area"]');
    const toolbar = host.querySelector('[data-yoda-surface="home-composer-toolbar"]');
    const settings = host.querySelector('[data-yoda-surface="home-composer-session-settings"]');
    const compare = host.querySelector('[data-yoda-surface="home-composer-compare-action"]');
    const settingsLabel = settings?.querySelector('span');
    const compareLabel = compare?.querySelector('span');

    expect(getComputedStyle(modal as Element).containerType).toBe('inline-size');
    expect(getComputedStyle(content as Element).paddingLeft).toBe('16px');
    expect(getComputedStyle(settingsLabel as Element).display).toBe('none');
    expect(getComputedStyle(compareLabel as Element).display).toBe('none');
    expect(settings?.parentElement).toBe(compare?.parentElement);
    expect(rect(compare).left - rect(settings).right).toBeGreaterThan(32);
    expect(rect(toolbar).right - rect(compare).right).toBeCloseTo(0, 0);
    expect((content as HTMLElement).scrollWidth).toBeLessThanOrEqual(
      (content as HTMLElement).clientWidth
    );
  });

  it('compacts the compare action before the session row wraps at medium widths', async () => {
    await renderAt(760, 600);

    const toolbar = host.querySelector('[data-yoda-surface="home-composer-toolbar"]');
    const controlRow = toolbar?.firstElementChild;
    const controls = Array.from(controlRow?.children ?? []);
    const settingsLabel = host.querySelector(
      '[data-yoda-surface="home-composer-session-settings"] > span'
    );
    const compareLabel = host.querySelector(
      '[data-yoda-surface="home-composer-compare-action"] > span'
    );
    const firstTop = rect(controls.at(0) ?? null).top;

    expect(controls).toHaveLength(5);
    expect(controls.every((control) => Math.abs(rect(control).top - firstTop) < 1)).toBe(true);
    expect(getComputedStyle(settingsLabel as Element).display).not.toBe('none');
    expect(getComputedStyle(compareLabel as Element).display).toBe('none');
  });

  it('keeps the desktop capture tray compact', async () => {
    await renderAt(900, 700);

    const content = host.querySelector('[data-slot="dialog-content-area"]');
    const toolbar = host.querySelector('[data-yoda-surface="home-composer-toolbar"]');
    const compare = host.querySelector('[data-yoda-surface="home-composer-compare-action"]');
    const compareLabel = compare?.querySelector('span');
    const textarea = host.querySelector('[data-slot="textarea"]');

    expect(getComputedStyle(content as Element).paddingLeft).toBe('20px');
    expect(rect(compare).width).toBeLessThan(rect(toolbar).width);
    expect(getComputedStyle(compareLabel as Element).display).not.toBe('none');
    expect(Number.parseFloat(getComputedStyle(textarea as Element).minHeight)).toBeCloseTo(112, 0);
  });

  it('compresses the prompt at low viewport heights', async () => {
    await renderAt(720, 480);

    const textarea = host.querySelector('[data-slot="textarea"]');
    const textareaStyle = getComputedStyle(textarea as Element);

    expect(Number.parseFloat(textareaStyle.minHeight)).toBeCloseTo(72, 0);
    expect(Number.parseFloat(textareaStyle.maxHeight)).toBeLessThanOrEqual(106);
  });

  it('keeps the new-conversation composer visible inside the Dream skin', async () => {
    await renderConversationAt(672, 700);

    const modal = host.querySelector('[data-yoda-surface="new-conversation-modal"]');
    const content = host.querySelector('[data-slot="dialog-content-area"]');
    const composer = host.querySelector('[data-yoda-surface="home-composer"]');
    const textarea = host.querySelector('[data-slot="textarea"]');

    expect(modal?.hasAttribute('data-yoda-composer-modal')).toBe(true);
    expect(getComputedStyle(modal as Element).containerType).toBe('inline-size');
    expect(getComputedStyle(composer as Element).marginTop).toBe('0px');
    expect(rect(composer).top).toBeGreaterThanOrEqual(rect(content).top);
    expect(Number.parseFloat(getComputedStyle(textarea as Element).minHeight)).toBeCloseTo(112, 0);
  });
});
