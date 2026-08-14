import { act, createElement, useCallback, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useDismissOnWindowBlur } from '@renderer/lib/hooks/use-dismiss-on-window-blur';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function BlurDismissHarness() {
  const [open, setOpen] = useState(false);
  const dismiss = useCallback(() => setOpen(false), []);
  useDismissOnWindowBlur(open, dismiss);

  return (
    <div>
      <button type="button" onClick={() => setOpen(true)}>
        Open
      </button>
      {open ? <div role="dialog">Model access</div> : null}
    </div>
  );
}

describe('useDismissOnWindowBlur', () => {
  let host: HTMLDivElement;
  let root: Root | null;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    if (root) await act(async () => root?.unmount());
    host.remove();
  });

  it('dismisses an open surface when the app window loses focus', async () => {
    await act(async () => root?.render(createElement(BlurDismissHarness)));
    await act(async () => host.querySelector<HTMLButtonElement>('button')?.click());

    expect(host.querySelector('[role="dialog"]')).not.toBeNull();

    await act(async () => window.dispatchEvent(new Event('blur')));

    expect(host.querySelector('[role="dialog"]')).toBeNull();
  });
});
