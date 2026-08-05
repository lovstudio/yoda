import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TaskTreeToggleButton } from '@renderer/features/sidebar/task-tree-toggle-button';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('TaskTreeToggleButton', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  it('treats a rapid double click as one toggle without opening or renaming the task', async () => {
    const onToggle = vi.fn();
    const onOpen = vi.fn();
    const onRename = vi.fn();

    await act(async () => {
      root.render(
        createElement(
          'div',
          { onClick: onOpen, onDoubleClick: onRename },
          createElement(TaskTreeToggleButton, {
            collapsed: true,
            label: 'Toggle subtasks',
            variant: 'root',
            onToggle,
          })
        )
      );
    });

    const button = host.querySelector('button');
    expect(button).not.toBeNull();

    await act(async () => {
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 2 }));
      button?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, detail: 2 }));
    });

    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onOpen).not.toHaveBeenCalled();
    expect(onRename).not.toHaveBeenCalled();
  });
});
