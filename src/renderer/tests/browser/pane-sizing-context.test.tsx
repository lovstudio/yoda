import { useLayoutEffect } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PaneSizingProvider,
  usePaneSizingContext,
  type PaneSizingContextValue,
} from '@renderer/lib/pty/pane-sizing-context';

const mocks = vi.hoisted(() => ({
  noteResize: vi.fn<(sessionId: string, cols: number, rows: number) => boolean>(),
  resize: vi.fn<(sessionId: string, cols: number, rows: number) => Promise<void>>(),
}));

vi.mock('@renderer/lib/ipc', () => ({
  rpc: {
    pty: {
      resize: mocks.resize,
    },
  },
}));

vi.mock('@renderer/lib/pty/pty', () => ({
  FrontendPty: {
    noteResize: mocks.noteResize,
  },
}));

function ContextProbe({ onValue }: { onValue: (value: PaneSizingContextValue | null) => void }) {
  const value = usePaneSizingContext();
  useLayoutEffect(() => {
    onValue(value);
  }, [onValue, value]);
  return null;
}

describe('PaneSizingProvider active-session resize ownership', () => {
  let host: HTMLDivElement;
  let root: Root;
  let receiveContext: ReturnType<typeof vi.fn<(value: PaneSizingContextValue | null) => void>>;

  beforeEach(() => {
    mocks.noteResize.mockReset().mockReturnValue(true);
    mocks.resize.mockReset().mockResolvedValue();
    receiveContext = vi.fn<(value: PaneSizingContextValue | null) => void>();
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    flushSync(() => root.unmount());
    host.remove();
  });

  function renderProvider(sessionIds: string[], activeSessionId: string | null): void {
    flushSync(() => {
      root.render(
        <PaneSizingProvider
          paneId="test-pane"
          sessionIds={sessionIds}
          activeSessionId={activeSessionId}
        >
          <ContextProbe onValue={receiveContext} />
        </PaneSizingProvider>
      );
    });
    expect(receiveContext).toHaveBeenCalled();
    expect(currentContext()).not.toBeNull();
  }

  function currentContext(): PaneSizingContextValue {
    const value = receiveContext.mock.lastCall?.[0];
    if (!value) throw new Error('PaneSizingContext value was not received');
    return value;
  }

  it('forwards a resize only for the active reporting session', () => {
    renderProvider(['active', 'background'], 'active');

    currentContext().reportDimensions('active', 120, 32);

    expect(mocks.noteResize).toHaveBeenCalledOnce();
    expect(mocks.noteResize).toHaveBeenCalledWith('active', 120, 32);
    expect(mocks.resize).toHaveBeenCalledOnce();
    expect(mocks.resize).toHaveBeenCalledWith('active', 120, 32);

    currentContext().reportDimensions('background', 140, 40);

    expect(mocks.noteResize).toHaveBeenCalledOnce();
    expect(mocks.resize).toHaveBeenCalledOnce();
  });

  it('waits for the newly active terminal to mount and report before resizing its backend', () => {
    renderProvider(['first'], 'first');
    currentContext().reportDimensions('first', 100, 24);
    expect(currentContext().getCurrentDimensions()).toEqual({ cols: 100, rows: 24 });

    mocks.noteResize.mockClear();
    mocks.resize.mockClear();

    // Adding a background session must not resize it to dimensions its
    // off-screen xterm has not adopted.
    renderProvider(['first', 'second'], 'first');
    expect(mocks.noteResize).not.toHaveBeenCalled();
    expect(mocks.resize).not.toHaveBeenCalled();

    // Switching active ownership also waits for the new usePty mount/measure
    // report. A late report from the old terminal is ignored.
    renderProvider(['first', 'second'], 'second');
    expect(mocks.resize).not.toHaveBeenCalled();
    currentContext().reportDimensions('first', 110, 28);
    expect(mocks.resize).not.toHaveBeenCalled();
    expect(currentContext().getCurrentDimensions()).toEqual({ cols: 100, rows: 24 });

    currentContext().reportDimensions('second', 110, 28);
    expect(mocks.noteResize).toHaveBeenCalledOnce();
    expect(mocks.noteResize).toHaveBeenCalledWith('second', 110, 28);
    expect(mocks.resize).toHaveBeenCalledOnce();
    expect(mocks.resize).toHaveBeenCalledWith('second', 110, 28);
  });

  it('ignores reports when there is no valid active session', () => {
    renderProvider(['first'], null);
    currentContext().reportDimensions('first', 80, 20);

    renderProvider(['first'], 'missing');
    currentContext().reportDimensions('missing', 80, 20);

    expect(currentContext().getCurrentDimensions()).toBeNull();
    expect(mocks.noteResize).not.toHaveBeenCalled();
    expect(mocks.resize).not.toHaveBeenCalled();
  });

  it('keeps per-session dedup from producing redundant resize RPCs', () => {
    mocks.noteResize.mockReturnValue(false);
    renderProvider(['active'], 'active');

    currentContext().reportDimensions('active', 120, 32);

    expect(mocks.noteResize).toHaveBeenCalledWith('active', 120, 32);
    expect(mocks.resize).not.toHaveBeenCalled();
  });
});
