import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@renderer/lib/ui/dropdown-menu';
import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from '@renderer/lib/ui/popover';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * Tailwind is not compiled for browser tests, so the shipped `data-closed`
 * exit animations never run here. These rules stand in for them.
 */
const EXIT_ANIMATION = `
@keyframes probe-exit { from { opacity: 1 } to { opacity: 0 } }
[data-slot='popover-content'][data-closed],
[data-slot='dropdown-menu-content'][data-closed] { animation: probe-exit 10s linear }
`;

/**
 * A popup is only unmounted once its exit animation reports completion. Real
 * clicks abort that animation all the time — navigating away hides an ancestor,
 * a re-render swaps the animated property — so cancelling it is the faithful
 * stand-in for "the user clicked something inside the panel".
 */
async function abortExitAnimation(popup: Element) {
  await act(async () => {
    // Hiding an ancestor is what a route change does to a retained view, and it
    // leaves the element with no animations at all rather than a replacement.
    (popup.parentElement as HTMLElement | null)?.style.setProperty('display', 'none');
    popup.getAnimations().forEach((animation) => animation.cancel());
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  });
}

describe('popup exit animation aborts', () => {
  let host: HTMLDivElement;
  let root: Root | null;
  let style: HTMLStyleElement;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    style = document.createElement('style');
    style.textContent = EXIT_ANIMATION;
    document.head.appendChild(style);
  });

  afterEach(async () => {
    if (root) await act(async () => root?.unmount());
    document
      .querySelectorAll('[data-slot="popover-content"], [data-slot="dropdown-menu-content"]')
      .forEach((element) => element.remove());
    style.remove();
    host.remove();
  });

  it('drops a popover whose exit animation never finishes', async () => {
    await act(async () =>
      root?.render(
        <Popover>
          <PopoverTrigger>Open</PopoverTrigger>
          <PopoverContent>
            <PopoverClose>Done</PopoverClose>
          </PopoverContent>
        </Popover>
      )
    );

    await act(async () => host.querySelector<HTMLButtonElement>('button')?.click());
    await act(async () =>
      document.querySelector<HTMLButtonElement>('[data-slot="popover-close"]')?.click()
    );

    const popup = document.querySelector('[data-slot="popover-content"]');
    expect(popup).not.toBeNull();
    if (!popup) return;
    await abortExitAnimation(popup);

    expect(document.querySelector('[data-slot="popover-content"]')).toBeNull();
  });

  it('drops a dropdown menu whose exit animation never finishes', async () => {
    await act(async () =>
      root?.render(
        <DropdownMenu>
          <DropdownMenuTrigger>Open</DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem>Rename</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )
    );

    await act(async () => host.querySelector<HTMLButtonElement>('button')?.click());
    await act(async () =>
      document.querySelector<HTMLElement>('[data-slot="dropdown-menu-item"]')?.click()
    );

    const popup = document.querySelector('[data-slot="dropdown-menu-content"]');
    expect(popup).not.toBeNull();
    if (!popup) return;
    await abortExitAnimation(popup);

    expect(document.querySelector('[data-slot="dropdown-menu-content"]')).toBeNull();
  });
});
