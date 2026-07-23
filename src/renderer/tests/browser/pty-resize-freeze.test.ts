import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyRendererPreferenceToAll, FrontendPty } from '@renderer/lib/pty/pty';

const webglMocks = vi.hoisted(() => ({
  clearTextureAtlas: vi.fn(),
}));

vi.mock('@xterm/addon-webgl', () => ({
  WebglAddon: class {
    readonly onContextLoss = (_listener: () => void) => ({ dispose: vi.fn() });

    activate() {}

    clearTextureAtlas() {
      webglMocks.clearTextureAtlas();
    }

    dispose() {}
  },
}));

vi.mock('@renderer/lib/ipc', () => ({
  events: {
    on: vi.fn(() => vi.fn()),
  },
  rpc: {
    app: {
      openExternal: vi.fn(),
    },
    pty: {
      subscribe: vi.fn(),
      unsubscribe: vi.fn(() => Promise.resolve()),
    },
  },
}));

vi.mock('@renderer/lib/hooks/use-toast', () => ({
  toast: vi.fn(),
}));

vi.mock('@renderer/lib/i18n', () => ({
  default: {
    t: (key: string) => key,
  },
}));

type PtyInternals = {
  freezeOverlay: HTMLCanvasElement | null;
  hasFreezeSnapshot: boolean;
  unfreezePhase: 'idle' | 'await-data' | 'await-render';
};

function setFreezeState(
  pty: FrontendPty,
  overlay: HTMLCanvasElement,
  phase: PtyInternals['unfreezePhase']
): void {
  const internals = pty as unknown as PtyInternals;
  internals.freezeOverlay = overlay;
  internals.hasFreezeSnapshot = true;
  internals.unfreezePhase = phase;
}

function createOverlay(pty: FrontendPty): HTMLCanvasElement {
  const overlay = document.createElement('canvas');
  overlay.width = 2;
  overlay.height = 2;
  const context = overlay.getContext('2d');
  if (!context) throw new Error('2D canvas is required for the resize snapshot test');
  context.fillStyle = '#ff00ff';
  context.fillRect(0, 0, overlay.width, overlay.height);
  overlay.style.display = 'none';
  pty.ownedContainer.appendChild(overlay);
  return overlay;
}

function expectSnapshotVisible(overlay: HTMLCanvasElement): void {
  expect(overlay.style.display).toBe('block');
  const pixel = overlay.getContext('2d')?.getImageData(0, 0, 1, 1).data;
  expect(Array.from(pixel ?? [])).toEqual([255, 0, 255, 255]);
}

function writeTerminal(pty: FrontendPty, data: string): Promise<void> {
  return new Promise((resolve) => pty.terminal.write(data, resolve));
}

describe('FrontendPty.commitResize', () => {
  let pty: FrontendPty | null = null;
  let mountTarget: HTMLDivElement | null = null;

  afterEach(() => {
    pty?.dispose();
    pty = null;
    mountTarget?.remove();
    mountTarget = null;
    webglMocks.clearTextureAtlas.mockClear();
  });

  it('invalidates the resize snapshot and fully redraws WebGL after scrolling', async () => {
    pty = new FrontendPty('session-scroll-redraw');
    pty.setRendererPreference('webgl');
    pty.flushPendingWrites();
    mountTarget = document.createElement('div');
    document.body.appendChild(mountTarget);
    pty.mount(mountTarget, { cols: 120, rows: 32 });
    await writeTerminal(
      pty,
      Array.from({ length: 80 }, (_, index) => `unique-row-${index}\r\n`).join('')
    );

    webglMocks.clearTextureAtlas.mockClear();
    const overlay = createOverlay(pty);
    setFreezeState(pty, overlay, 'idle');

    pty.terminal.scrollToTop();
    pty.terminal.scrollLines(1);
    pty.terminal.scrollLines(1);

    expect((pty as unknown as PtyInternals).hasFreezeSnapshot).toBe(false);
    await vi.waitFor(() => expect(webglMocks.clearTextureAtlas).toHaveBeenCalledTimes(1));
  });

  it('defers WebGL recovery while off-screen and redraws cleanly when mounted', async () => {
    pty = new FrontendPty('session-background-scroll');
    pty.setRendererPreference('webgl');
    pty.flushPendingWrites();
    await writeTerminal(
      pty,
      Array.from({ length: 80 }, (_, index) => `background-row-${index}\r\n`).join('')
    );

    webglMocks.clearTextureAtlas.mockClear();
    pty.terminal.scrollToTop();
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    expect(webglMocks.clearTextureAtlas).not.toHaveBeenCalled();

    mountTarget = document.createElement('div');
    document.body.appendChild(mountTarget);
    pty.mount(mountTarget, { cols: 120, rows: 32 });

    await vi.waitFor(() => expect(webglMocks.clearTextureAtlas).toHaveBeenCalledTimes(1));
  });

  it('switches and redraws every live terminal renderer immediately', () => {
    pty = new FrontendPty('session-renderer-toggle');
    pty.setRendererPreference('webgl');
    expect(pty.getRendererDiagnosticsEntry().engine).toBe('webgl');

    applyRendererPreferenceToAll('dom');
    expect(pty.getRendererDiagnosticsEntry().engine).toBe('dom');

    webglMocks.clearTextureAtlas.mockClear();
    applyRendererPreferenceToAll('webgl');
    expect(pty.getRendererDiagnosticsEntry().engine).toBe('webgl');
    expect(webglMocks.clearTextureAtlas).toHaveBeenCalled();
  });

  it('keeps the previous frame visible while a wider grid renders', async () => {
    pty = new FrontendPty('session-grow');
    pty.flushPendingWrites();
    pty.terminal.resize(120, 32);

    const overlay = createOverlay(pty);
    setFreezeState(pty, overlay, 'idle');

    pty.commitResize(133, 32);

    expect(pty.terminal.cols).toBe(133);
    expectSnapshotVisible(overlay);
    await vi.waitFor(() => expect(overlay.style.display).toBe('none'));
  });

  it('keeps visible pixels through an immediate shrink-to-grow reversal', async () => {
    pty = new FrontendPty('session-resize-reversal');
    pty.flushPendingWrites();
    pty.terminal.resize(133, 32);

    const overlay = createOverlay(pty);
    setFreezeState(pty, overlay, 'idle');

    pty.commitResize(120, 32);
    expectSnapshotVisible(overlay);

    pty.commitResize(140, 32);

    expect(pty.terminal.cols).toBe(140);
    expectSnapshotVisible(overlay);
    await vi.waitFor(() => expect(overlay.style.display).toBe('none'));
  });

  it('keeps the freeze frame when shrinking until the unfreeze chain runs', () => {
    pty = new FrontendPty('session-shrink');
    pty.flushPendingWrites();
    pty.terminal.resize(133, 32);

    const overlay = createOverlay(pty);
    setFreezeState(pty, overlay, 'idle');

    pty.commitResize(120, 32);

    expect(pty.terminal.cols).toBe(120);
    expectSnapshotVisible(overlay);
  });
});
