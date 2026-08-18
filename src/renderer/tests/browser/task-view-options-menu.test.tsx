import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type * as ReactI18nextModule from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_TASK_VIEW_OPTIONS, type TaskViewItem } from '@shared/task-view-options';
import '../../index.css';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof ReactI18nextModule>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));

function taskViewItem(overrides: Partial<TaskViewItem>): TaskViewItem {
  return {
    projectId: 'project-1',
    projectName: 'Alpha',
    status: 'awaiting-input',
    name: 'task',
    createdAt: '2026-08-01 00:00:00',
    lastInteractedAt: '2026-08-01 00:00:00',
    statusChangedAt: '2026-08-01 00:00:00',
    ...overrides,
  };
}

function pointerAt(type: string, target: Element | Document, x: number, y: number) {
  const event = new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: x,
    clientY: y,
    button: 0,
    isPrimary: true,
    pointerId: 1,
  });
  target.dispatchEvent(event);
}

function center(element: Element) {
  const rect = element.getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

describe('Task view options menu', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    // Close the menu before unmounting. Tearing down a tree with an open popup
    // leaves Base UI's global bookkeeping believing a menu is still up, and the
    // next test's trigger then refuses to open.
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    await act(async () => new Promise((resolve) => setTimeout(resolve, 250)));
    await act(async () => root.unmount());
    host.remove();
  });

  it('ranks a classification by dragging its items and sorts by that ranking', async () => {
    const { TaskViewOptionsMenu } = await import('@renderer/lib/components/task-view-options-menu');
    const onChange = vi.fn();
    const items = [
      taskViewItem({ status: 'awaiting-input' }),
      taskViewItem({ status: 'working' }),
      taskViewItem({ status: 'completed' }),
    ];

    await act(async () =>
      root.render(
        createElement(TaskViewOptionsMenu, {
          items,
          options: DEFAULT_TASK_VIEW_OPTIONS,
          onChange,
        })
      )
    );

    const trigger = host.querySelector<HTMLElement>('[data-slot="dropdown-menu-trigger"]');
    expect(trigger).not.toBeNull();
    await act(async () => trigger?.click());

    const statusSubTrigger = [
      ...document.querySelectorAll<HTMLElement>('[data-slot="dropdown-menu-sub-trigger"]'),
    ].find((node) => node.textContent?.includes('taskViewOptions.filterByStatus'));
    expect(statusSubTrigger).toBeTruthy();
    await act(async () => statusSubTrigger?.click());

    const handles = [
      ...document.querySelectorAll<HTMLElement>('span[aria-label="taskViewOptions.reorder"]'),
    ];
    // Statuses present in `items`, in the shipped priority order.
    expect(handles).toHaveLength(3);

    const from = handles[1];
    const to = handles[0];
    expect(from).toBeTruthy();
    expect(to).toBeTruthy();
    if (!from || !to) return;
    const start = center(from);
    const end = center(to);

    // One act per step: dnd-kit measures droppable rects in an effect after the
    // drag starts, so a batched gesture would end before anything is over.
    await act(async () => pointerAt('pointerdown', from, start.x, start.y));
    await act(async () => pointerAt('pointermove', document, start.x, start.y - 8));
    await act(async () => pointerAt('pointermove', document, end.x, end.y));
    await act(async () => pointerAt('pointerup', document, end.x, end.y));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0]?.[0]).toMatchObject({
      sortMode: 'status',
      sortDescending: false,
      // 'error' is absent from `items`, so the ranked list is what the menu offers.
      statusOrder: ['completed', 'awaiting-input', 'working'],
    });
  });

  it('keeps the row a filter toggle and the handle a drag handle', async () => {
    const { TaskViewOptionsMenu } = await import('@renderer/lib/components/task-view-options-menu');
    const onChange = vi.fn();

    await act(async () =>
      root.render(
        createElement(TaskViewOptionsMenu, {
          items: [taskViewItem({ status: 'awaiting-input' }), taskViewItem({ status: 'working' })],
          options: DEFAULT_TASK_VIEW_OPTIONS,
          onChange,
        })
      )
    );

    const trigger = host.querySelector<HTMLElement>('[data-slot="dropdown-menu-trigger"]');
    await act(async () => trigger?.click());
    const statusSubTrigger = [
      ...document.querySelectorAll<HTMLElement>('[data-slot="dropdown-menu-sub-trigger"]'),
    ].find((node) => node.textContent?.includes('taskViewOptions.filterByStatus'));
    await act(async () => statusSubTrigger?.click());

    const handle = document.querySelector<HTMLElement>(
      'span[aria-label="taskViewOptions.reorder"]'
    );
    await act(async () => handle?.click());
    expect(onChange).not.toHaveBeenCalled();

    const row = document.querySelector<HTMLElement>('[data-slot="dropdown-menu-checkbox-item"]');
    await act(async () => row?.click());
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0]?.[0]).toMatchObject({
      statuses: ['awaiting-input'],
      sortMode: 'default',
    });
  });
});
