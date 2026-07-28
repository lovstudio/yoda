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

  it('recognizes common home/fence sequences as full TUI repaints', () => {
    const looksLikeRepaint = (
      FrontendPty as unknown as { looksLikeRepaint: (data: string) => boolean }
    ).looksLikeRepaint;

    expect(looksLikeRepaint('\x1b[1;1Hredraw')).toBe(true);
    expect(looksLikeRepaint('\x1b[1;1fredraw')).toBe(true);
    expect(looksLikeRepaint('\x1b[?2026hbatched\x1b[?2026l')).toBe(true);
    expect(looksLikeRepaint('\x1b[35;1Hincremental-row')).toBe(false);
  });

  it('releases the freeze overlay backing store when unmounted', () => {
    pty = new FrontendPty('session-overlay-release');
    mountTarget = document.createElement('div');
    document.body.appendChild(mountTarget);
    const lease = pty.mount(mountTarget, { cols: 120, rows: 32 });
    const overlay = createOverlay(pty);
    overlay.width = 640;
    overlay.height = 320;
    setFreezeState(pty, overlay, 'idle');

    pty.unmount(lease);

    expect(overlay.width).toBe(0);
    expect(overlay.height).toBe(0);
    expect(overlay.parentElement).toBeNull();
    expect((pty as unknown as PtyInternals).freezeOverlay).toBeNull();
  });

  it('invalidates the resize snapshot without clearing the shared glyph atlas', async () => {
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
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    expect(webglMocks.clearTextureAtlas).not.toHaveBeenCalled();
  });

  it('defers WebGL recovery while off-screen and redraws cleanly when mounted', async () => {
    pty = new FrontendPty('session-background-scroll');
    pty.setRendererPreference('webgl');
    expect(pty.getRendererDiagnosticsEntry().engine).toBe('dom');
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

    expect(pty.getRendererDiagnosticsEntry().engine).toBe('webgl');
    expect(webglMocks.clearTextureAtlas).not.toHaveBeenCalled();

    pty.unmount();
    expect(pty.getRendererDiagnosticsEntry().engine).toBe('dom');
    pty.mount(mountTarget, { cols: 120, rows: 32 });
    expect(pty.getRendererDiagnosticsEntry().engine).toBe('webgl');
  });

  it('switches and redraws every live terminal renderer immediately', () => {
    pty = new FrontendPty('session-renderer-toggle');
    mountTarget = document.createElement('div');
    document.body.appendChild(mountTarget);
    pty.mount(mountTarget, { cols: 120, rows: 32 });
    pty.setRendererPreference('webgl');
    expect(pty.getRendererDiagnosticsEntry().engine).toBe('webgl');

    applyRendererPreferenceToAll('dom');
    expect(pty.getRendererDiagnosticsEntry().engine).toBe('dom');

    webglMocks.clearTextureAtlas.mockClear();
    applyRendererPreferenceToAll('webgl');
    expect(pty.getRendererDiagnosticsEntry().engine).toBe('webgl');
    expect(webglMocks.clearTextureAtlas).not.toHaveBeenCalled();
  });

  it('ignores a stale unmount cleanup after a newer host claims the terminal', () => {
    pty = new FrontendPty('session-mount-lease');
    const firstTarget = document.createElement('div');
    const secondTarget = document.createElement('div');
    document.body.append(firstTarget, secondTarget);
    mountTarget = secondTarget;

    const firstLease = pty.mount(firstTarget, { cols: 100, rows: 24 });
    const secondLease = pty.mount(secondTarget, { cols: 120, rows: 30 });
    pty.unmount(firstLease);

    expect(pty.ownedContainer.parentElement).toBe(secondTarget);
    expect(pty.terminal.cols).toBe(120);
    pty.unmount(secondLease);
    expect(pty.ownedContainer.parentElement).not.toBe(secondTarget);
    firstTarget.remove();
  });

  it('keeps only the latest host through repeated mount and stale-unmount churn', () => {
    pty = new FrontendPty('session-mount-lease-churn');
    pty.setRendererPreference('dom');
    const targets = Array.from({ length: 64 }, () => document.createElement('div'));
    document.body.append(...targets);
    mountTarget = targets.at(-1) ?? null;

    const leases: number[] = [];
    for (const [index, target] of targets.entries()) {
      leases.push(pty.mount(target, { cols: 80 + index, rows: 24 + (index % 8) }));

      // React cleanup from the prior host can run after the new effect mounts.
      // Every stale cleanup must leave exactly one live host untouched.
      if (index > 0) pty.unmount(leases[index - 1]);
      expect(pty.ownedContainer.parentElement).toBe(target);
      expect(targets.filter((candidate) => candidate.contains(pty!.ownedContainer))).toEqual([
        target,
      ]);
    }

    for (const staleLease of leases.slice(0, -1).reverse()) {
      pty.unmount(staleLease);
      expect(pty.ownedContainer.parentElement).toBe(targets.at(-1));
    }
    expect(pty.terminal.cols).toBe(143);
    expect(pty.terminal.rows).toBe(31);

    pty.unmount(leases.at(-1));
    expect(targets.some((target) => target.contains(pty!.ownedContainer))).toBe(false);
    for (const target of targets.slice(0, -1)) target.remove();
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
