import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PoolEntry } from '@renderer/lib/monaco/monaco-pool';
import { useMonacoLease } from '@renderer/lib/monaco/use-monaco-lease';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('useMonacoLease', () => {
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

  it('does not acquire an editor until the owning surface requests it', async () => {
    const entry: PoolEntry<object> = {
      editor: {},
      container: document.createElement('div'),
      status: 'leased',
      disposables: [],
    };
    const pool = {
      lease: vi.fn(async () => entry),
      release: vi.fn(),
    };

    function Harness({ enabled }: { enabled: boolean }) {
      useMonacoLease(pool, enabled);
      return null;
    }

    await act(async () => {
      root.render(<Harness enabled={false} />);
      await Promise.resolve();
    });
    expect(pool.lease).not.toHaveBeenCalled();

    await act(async () => {
      root.render(<Harness enabled />);
      await Promise.resolve();
    });
    expect(pool.lease).toHaveBeenCalledTimes(1);

    await act(async () => {
      root.render(<Harness enabled={false} />);
      await Promise.resolve();
    });
    expect(pool.release).toHaveBeenCalledWith(entry);
  });
});
