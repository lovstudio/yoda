import { observable, runInAction } from 'mobx';
import { observer } from 'mobx-react-lite';
import { act, Activity, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { dismissBeforeSynchronousAction } from '@renderer/lib/dismiss-before-synchronous-action';
import { Popover, PopoverContent, PopoverTrigger } from '@renderer/lib/ui/popover';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('dismissBeforeSynchronousAction', () => {
  let host: HTMLDivElement;
  let root: Root | null;
  let route: ReturnType<typeof observable.box<'task' | 'maas'>>;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    route = observable.box<'task' | 'maas'>('task');
  });

  afterEach(async () => {
    if (root) await act(async () => root?.unmount());
    document
      .querySelectorAll('[data-slot="popover-content"]')
      .forEach((element) => element.remove());
    host.remove();
  });

  it('closes a portal before synchronous navigation hides but retains its source view', async () => {
    const RetainedTaskView = observer(function RetainedTaskView() {
      const [open, setOpen] = useState(false);

      return (
        <section data-view="task">
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger>Model access</PopoverTrigger>
            <PopoverContent>
              <button
                type="button"
                onClick={() =>
                  dismissBeforeSynchronousAction(
                    () => setOpen(false),
                    () => runInAction(() => route.set('maas'))
                  )
                }
              >
                Details and configuration
              </button>
            </PopoverContent>
          </Popover>
        </section>
      );
    });

    const RetainedViews = observer(function RetainedViews() {
      return (
        <>
          <Activity mode={route.get() === 'task' ? 'visible' : 'hidden'}>
            <RetainedTaskView />
          </Activity>
          <section data-view="maas" hidden={route.get() !== 'maas'}>
            MaaS settings
          </section>
        </>
      );
    });

    await act(async () => root?.render(<RetainedViews />));

    const trigger = host.querySelector<HTMLButtonElement>('button');
    await act(async () => trigger?.click());
    expect(trigger?.getAttribute('aria-expanded')).toBe('true');

    const details = document.querySelector<HTMLButtonElement>(
      '[data-slot="popover-content"] button'
    );
    expect(details).not.toBeNull();
    await act(async () => details?.click());

    expect(host.querySelector<HTMLElement>('[data-view="task"]')?.style.display).toBe('none');
    expect(host.querySelector<HTMLElement>('[data-view="maas"]')?.hidden).toBe(false);
    expect(trigger?.getAttribute('aria-expanded')).toBe('false');
    expect(document.querySelector('[data-slot="popover-content"][data-open]')).toBeNull();
  });
});
