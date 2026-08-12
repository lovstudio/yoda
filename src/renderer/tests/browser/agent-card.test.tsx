import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { AgentCard } from '@renderer/lib/components/agent-card/agent-card';
import { TooltipProvider } from '@renderer/lib/ui/tooltip';
import '../../index.css';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('AgentCard', () => {
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

  it('keeps canonical actions visible, ordered, and right-aligned', async () => {
    const onEdit = vi.fn();
    const onDuplicate = vi.fn();
    const onDelete = vi.fn();
    await act(async () =>
      root.render(
        <TooltipProvider>
          <AgentCard
            name="Researcher"
            onEdit={onEdit}
            editLabel="Edit agent"
            onDuplicate={onDuplicate}
            duplicateLabel="Duplicate agent"
            onDelete={onDelete}
            deleteLabel="Delete agent"
          />
        </TooltipProvider>
      )
    );

    const actions = host.querySelector<HTMLElement>('[data-testid="agent-card-actions"]');
    const actionButtons = Array.from(actions?.querySelectorAll('button') ?? []);
    expect(actionButtons.map((button) => button.getAttribute('aria-label'))).toEqual([
      'Edit agent',
      'Duplicate agent',
      'Delete agent',
    ]);
    expect(actions?.classList.contains('opacity-0')).toBe(false);
    expect(actions?.classList.contains('ml-auto')).toBe(true);

    const duplicateButton = actionButtons.find(
      (button) => button.getAttribute('aria-label') === 'Duplicate agent'
    );
    expect(duplicateButton).toBeDefined();

    await act(async () => {
      await userEvent.click(duplicateButton!);
    });

    expect(onDuplicate).toHaveBeenCalledOnce();
  });
});
