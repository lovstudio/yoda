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

  it('exposes the canonical duplicate action when requested', async () => {
    const onDuplicate = vi.fn();
    await act(async () =>
      root.render(
        <TooltipProvider>
          <AgentCard name="Researcher" onDuplicate={onDuplicate} duplicateLabel="Duplicate agent" />
        </TooltipProvider>
      )
    );

    const duplicateButton = host.querySelector<HTMLButtonElement>(
      'button[aria-label="Duplicate agent"]'
    );
    expect(duplicateButton).not.toBeNull();
    expect(
      host
        .querySelector<HTMLElement>('[data-testid="agent-card-actions"]')
        ?.classList.contains('opacity-0')
    ).toBe(false);

    await act(async () => {
      await userEvent.click(duplicateButton!);
    });

    expect(onDuplicate).toHaveBeenCalledOnce();
  });
});
