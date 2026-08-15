import { observable, runInAction } from 'mobx';
import { observer } from 'mobx-react-lite';
import { act, Activity, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { usePopoverDismiss } from '@renderer/lib/hooks/use-popover-dismiss';
import { Popover, PopoverContent, PopoverTrigger } from '@renderer/lib/ui/popover';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * Tailwind is not compiled for browser tests, so the shipped exit animation
 * never runs here. This rule stands in for it, and holds the popup in the state
 * Base UI will not unmount on its own: closed, but still animating.
 */
const SLOW_EXIT_ANIMATION = `
@keyframes probe-exit { from { opacity: 1 } to { opacity: 0 } }
[data-slot='popover-content'][data-closed] { animation: probe-exit 10s linear }
`;

describe('usePopoverDismiss', () => {
  let host: HTMLDivElement;
  let root: Root | null;
  let style: HTMLStyleElement;
  let route: ReturnType<typeof observable.box<'task' | 'maas'>>;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    style = document.createElement('style');
    style.textContent = SLOW_EXIT_ANIMATION;
    document.head.appendChild(style);
    route = observable.box<'task' | 'maas'>('task');
  });

  afterEach(async () => {
    if (root) await act(async () => root?.unmount());
    document
      .querySelectorAll('[data-slot="popover-content"]')
      .forEach((element) => element.remove());
    style.remove();
    host.remove();
  });

  const openDetails = async () => {
    const trigger = host.querySelector<HTMLButtonElement>('button');
    await act(async () => trigger?.click());
    expect(trigger?.getAttribute('aria-expanded')).toBe('true');

    const details = document.querySelector<HTMLButtonElement>(
      '[data-slot="popover-content"] button'
    );
    expect(details).not.toBeNull();
    await act(async () => details?.click());

    return trigger;
  };

  it('drops the popup on dismissal instead of waiting for the exit animation', async () => {
    const TaskView = observer(function TaskView() {
      const [open, setOpen] = useState(false);
      const { actionsRef, dismissThen } = usePopoverDismiss(open, setOpen);

      return (
        <section data-view="task">
          <Popover open={open} onOpenChange={setOpen} actionsRef={actionsRef}>
            <PopoverTrigger>Model access</PopoverTrigger>
            <PopoverContent>
              <button
                type="button"
                onClick={() => dismissThen(() => runInAction(() => route.set('maas')))}
              >
                Details and configuration
              </button>
            </PopoverContent>
          </Popover>
        </section>
      );
    });

    const Views = observer(function Views() {
      return (
        <>
          <Activity mode={route.get() === 'task' ? 'visible' : 'hidden'}>
            <TaskView />
          </Activity>
          <section data-view="maas" hidden={route.get() !== 'maas'}>
            MaaS settings
          </section>
        </>
      );
    });

    await act(async () => root?.render(<Views />));
    const trigger = await openDetails();

    expect(host.querySelector<HTMLElement>('[data-view="task"]')?.style.display).toBe('none');
    expect(host.querySelector<HTMLElement>('[data-view="maas"]')?.hidden).toBe(false);
    expect(trigger?.getAttribute('aria-expanded')).toBe('false');
    expect(document.querySelector('[data-slot="popover-content"]')).toBeNull();

    // A forced unmount must not leave the popover inert: it has to open again.
    await act(async () => runInAction(() => route.set('task')));
    await act(async () => trigger?.click());
    expect(document.querySelector('[data-slot="popover-content"]')).not.toBeNull();
  });

  it('leaves a stranded popup when only the open state is flipped', async () => {
    const TaskView = observer(function TaskView() {
      const [open, setOpen] = useState(false);

      return (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger>Model access</PopoverTrigger>
          <PopoverContent>
            <button type="button" onClick={() => setOpen(false)}>
              Details and configuration
            </button>
          </PopoverContent>
        </Popover>
      );
    });

    await act(async () => root?.render(<TaskView />));
    await openDetails();

    // The regression this hook exists for: Base UI holds the closed popup in the
    // DOM until its exit animation reports completion.
    const popup = document.querySelector('[data-slot="popover-content"]');
    expect(popup).not.toBeNull();
    expect(popup?.hasAttribute('data-closed')).toBe(true);
  });
});
