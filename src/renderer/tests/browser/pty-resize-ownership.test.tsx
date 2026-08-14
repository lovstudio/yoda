import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PaneSizingProvider } from '@renderer/lib/pty/pane-sizing-context';
import { FrontendPty } from '@renderer/lib/pty/pty';
import { PtyPane } from '@renderer/lib/pty/pty-pane';

const mocks = vi.hoisted(() => ({
  resize: vi.fn<(sessionId: string, cols: number, rows: number) => Promise<void>>(),
}));

vi.mock('@renderer/lib/ipc', () => ({
  events: {
    on: vi.fn(() => vi.fn()),
  },
  rpc: {
    app: {
      clipboardWriteText: vi.fn(async () => ({ success: true })),
      openExternal: vi.fn(async () => undefined),
    },
    appSettings: {
      get: vi.fn(async () => ({
        autoCopyOnSelection: false,
        scrollbackLines: 10_000,
      })),
    },
    pty: {
      resize: mocks.resize,
      subscribe: vi.fn(async () => ({
        success: true,
        data: { buffer: '', generation: 1, sequence: 0 },
      })),
      unsubscribe: vi.fn(async () => undefined),
      acknowledgeOutput: vi.fn(async () => undefined),
      heartbeatConsumer: vi.fn(async () => undefined),
    },
  },
}));

vi.mock('@renderer/lib/pty/pty-dimensions', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    getCellMetrics: () => ({ width: 8, height: 15 }),
    measureDimensions: () => ({ cols: 128, rows: 43 }),
  };
});

vi.mock('@renderer/lib/pty/terminal-link-menu', () => ({
  TerminalLinkMenu: () => null,
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('PTY resize ownership handoff', () => {
  const sessionId = 'staged-resize-owner';
  let host: HTMLDivElement;
  let root: Root;
  let pty: FrontendPty;

  beforeEach(() => {
    mocks.resize.mockReset().mockResolvedValue();
    host = document.createElement('div');
    Object.assign(host.style, {
      position: 'absolute',
      width: '1024px',
      height: '653px',
      display: 'flex',
      flexDirection: 'column',
    });
    document.body.appendChild(host);
    root = createRoot(host);
    pty = new FrontendPty(sessionId);
    pty.flushPendingWrites();
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    pty.dispose();
    host.remove();
  });

  function render(activeSessionId: string | null): void {
    root.render(
      <PaneSizingProvider
        paneId="staged-conversation"
        sessionIds={[sessionId]}
        activeSessionId={activeSessionId}
      >
        <PtyPane sessionId={sessionId} pty={pty} />
      </PaneSizingProvider>
    );
  }

  it('synchronizes the backend when staging grants ownership without changing pane pixels', async () => {
    await act(async () => {
      render(null);
    });

    await vi.waitFor(() => {
      expect(pty.terminal.rows).toBeGreaterThan(40);
    });

    const stagedDimensions = { cols: pty.terminal.cols, rows: pty.terminal.rows };
    expect(mocks.resize).not.toHaveBeenCalled();
    // The generation-bound staging resize can settle after xterm measured the
    // final pane and overwrite the renderer's bookkeeping with the backend's
    // earlier, shorter grid. Ownership handoff must still re-report live DOM.
    pty.lastSentDims = { cols: stagedDimensions.cols, rows: 14 };
    expect(pty.lastSentDims).toEqual({ cols: stagedDimensions.cols, rows: 14 });
    const stagedRect = host.getBoundingClientRect();
    const stagedPixels = { width: stagedRect.width, height: stagedRect.height };

    await act(async () => {
      render(sessionId);
    });

    await vi.waitFor(() => {
      expect(mocks.resize).toHaveBeenCalledWith(
        sessionId,
        stagedDimensions.cols,
        stagedDimensions.rows
      );
    });

    const finalRect = host.getBoundingClientRect();
    expect({ width: finalRect.width, height: finalRect.height }).toEqual(stagedPixels);
    expect(pty.lastSentDims).toEqual(stagedDimensions);
  });
});
