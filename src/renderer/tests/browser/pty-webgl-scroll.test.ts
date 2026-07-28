import { afterEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import '@xterm/xterm/css/xterm.css';
import { FrontendPty } from '@renderer/lib/pty/pty';

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

function writeTerminal(pty: FrontendPty, data: string): Promise<void> {
  return new Promise((resolve) => pty.terminal.write(data, resolve));
}

function uniqueRow(index: number): string {
  let state = index + 1;
  let pattern = '';
  for (let column = 0; column < 48; column += 1) {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    pattern += (state & 0x8000_0000) === 0 ? 'i' : 'M';
  }
  return `row-${index.toString(36).padStart(2, '0')} ${pattern}`;
}

async function nextAnimationFrame(): Promise<void> {
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

async function screenshotPixels(element: HTMLElement): Promise<ImageData> {
  const base64 = await page.screenshot({ element, save: false });
  const image = new Image();
  image.src = `data:image/png;base64,${base64}`;
  await image.decode();

  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('2D canvas is required for terminal screenshot analysis');
  context.drawImage(image, 0, 0);
  return context.getImageData(0, 0, canvas.width, canvas.height);
}

function hashRenderedRows(image: ImageData, rows: number): number[] {
  const hashes: number[] = [];
  const rowHeight = image.height / rows;

  // Ignore the first and last row: xterm can draw its cursor on the last row,
  // while the first row can share the screen's top border on fractional DPRs.
  for (let row = 1; row < rows - 1; row += 1) {
    const startY = Math.ceil(row * rowHeight + 1);
    const endY = Math.floor((row + 1) * rowHeight - 1);
    let hash = 2_166_136_261;
    let inkPixels = 0;

    for (let y = startY; y < endY; y += 1) {
      for (let x = 0; x < image.width; x += 1) {
        const offset = (y * image.width + x) * 4;
        const luminance =
          image.data[offset] * 0.2126 +
          image.data[offset + 1] * 0.7152 +
          image.data[offset + 2] * 0.0722;
        const isInk = image.data[offset + 3] > 0 && luminance < 220;
        if (isInk) inkPixels += 1;
        hash ^= isInk ? 1 : 0;
        hash = Math.imul(hash, 16_777_619) >>> 0;
      }
    }

    expect(inkPixels).toBeGreaterThan(20);
    hashes.push(hash);
  }

  return hashes;
}

function hashImage(image: ImageData): number {
  let hash = 2_166_136_261;
  for (const channel of image.data) {
    hash ^= channel;
    hash = Math.imul(hash, 16_777_619) >>> 0;
  }
  return hash;
}

function countDifferentChannels(first: ImageData, second: ImageData): number {
  if (first.width !== second.width || first.height !== second.height)
    return Number.POSITIVE_INFINITY;
  let differences = 0;
  for (let index = 0; index < first.data.length; index += 1) {
    if (first.data[index] !== second.data[index]) differences += 1;
  }
  return differences;
}

describe('FrontendPty WebGL scrolling', () => {
  const ptys: FrontendPty[] = [];
  const mountTargets: HTMLDivElement[] = [];

  afterEach(() => {
    vi.useRealTimers();
    for (const pty of ptys.splice(0)) pty.dispose();
    for (const target of mountTargets.splice(0)) target.remove();
  });

  it('renders every visible row once after sustained output scrolling', async () => {
    const mountTarget = document.createElement('div');
    mountTargets.push(mountTarget);
    Object.assign(mountTarget.style, {
      position: 'absolute',
      left: '0',
      top: '0',
      width: '900px',
      height: '420px',
      background: '#ffffff',
    });
    document.body.appendChild(mountTarget);

    const pty = new FrontendPty('session-webgl-visual', {
      override: {
        background: '#ffffff',
        foreground: '#111111',
        cursor: '#111111',
      },
    });
    ptys.push(pty);
    pty.setRendererPreference('webgl');
    pty.flushPendingWrites();
    pty.mount(mountTarget, { cols: 80, rows: 24 });
    expect(pty.getRendererDiagnosticsEntry().engine).toBe('webgl');

    // Deliver output across multiple renderer frames instead of as one parser
    // chunk. This is the shape that previously exposed stale WebGL rows during
    // sustained agent output.
    for (let batch = 0; batch < 20; batch += 1) {
      await writeTerminal(
        pty,
        Array.from({ length: 12 }, (_, offset) => `${uniqueRow(batch * 12 + offset)}\r\n`).join('')
      );
      if (batch % 4 === 3) await nextAnimationFrame();
    }
    pty.terminal.scrollToBottom();
    await nextAnimationFrame();
    await nextAnimationFrame();

    const screen = pty.ownedContainer.querySelector<HTMLElement>('.xterm-screen');
    if (!screen) throw new Error('xterm screen was not mounted');
    const pixels = await screenshotPixels(screen);
    const rowHashes = hashRenderedRows(pixels, pty.terminal.rows);
    const counts = new Map<number, number>();
    for (const hash of rowHashes) counts.set(hash, (counts.get(hash) ?? 0) + 1);

    // A single collision can occur from glyph rasterization at fractional DPR,
    // but the original regression repeated the same row across most of the
    // viewport. Keep both a unique-row ratio and a hard repetition cap.
    expect(new Set(rowHashes).size).toBeGreaterThanOrEqual(Math.floor(rowHashes.length * 0.9));
    expect(Math.max(...counts.values())).toBeLessThanOrEqual(2);
  });

  it('keeps a sibling WebGL terminal pixel-stable while the other scrolls and is disposed', async () => {
    const firstTarget = document.createElement('div');
    const secondTarget = document.createElement('div');
    mountTargets.push(firstTarget, secondTarget);
    for (const [index, target] of [firstTarget, secondTarget].entries()) {
      Object.assign(target.style, {
        position: 'absolute',
        left: `${index * 710}px`,
        top: '0',
        width: '700px',
        height: '360px',
        background: '#ffffff',
      });
    }
    document.body.append(firstTarget, secondTarget);

    const first = new FrontendPty('session-webgl-atlas-first', {
      override: {
        background: '#ffffff',
        foreground: '#191919',
        cursor: '#ffffff',
      },
    });
    const second = new FrontendPty('session-webgl-atlas-second', {
      override: {
        background: '#ffffff',
        foreground: '#191919',
        cursor: '#ffffff',
      },
    });
    ptys.push(first, second);
    for (const [pty, target] of [
      [first, firstTarget],
      [second, secondTarget],
    ] as const) {
      pty.setRendererPreference('webgl');
      pty.flushPendingWrites();
      pty.mount(target, { cols: 72, rows: 20 });
      expect(pty.getRendererDiagnosticsEntry().engine).toBe('webgl');
    }

    await writeTerminal(
      first,
      Array.from({ length: 120 }, (_, index) => `mutable-${uniqueRow(index)}\r\n`).join('')
    );
    await writeTerminal(
      second,
      Array.from({ length: 20 }, (_, index) => `stable-${uniqueRow(index + 500)}\r\n`).join('')
    );
    first.terminal.scrollToTop();
    await nextAnimationFrame();
    await nextAnimationFrame();

    const secondScreen = second.ownedContainer.querySelector<HTMLElement>('.xterm-screen');
    if (!secondScreen) throw new Error('sibling xterm screen was not mounted');
    const before = await screenshotPixels(secondScreen);

    for (let iteration = 0; iteration < 12; iteration += 1) {
      first.terminal.scrollLines(iteration % 2 === 0 ? 5 : -3);
      await nextAnimationFrame();
    }
    second.terminal.refresh(0, second.terminal.rows - 1);
    await nextAnimationFrame();
    const afterScroll = await screenshotPixels(secondScreen);
    expect(hashImage(afterScroll)).toBe(hashImage(before));
    expect(countDifferentChannels(afterScroll, before)).toBe(0);

    first.dispose();
    ptys.splice(ptys.indexOf(first), 1);
    second.terminal.refresh(0, second.terminal.rows - 1);
    await nextAnimationFrame();
    await nextAnimationFrame();

    expect(second.getRendererDiagnosticsEntry().engine).toBe('webgl');
    const afterSiblingDispose = await screenshotPixels(secondScreen);
    expect(hashImage(afterSiblingDispose)).toBe(hashImage(before));
    expect(countDifferentChannels(afterSiblingDispose, before)).toBe(0);
  });

  it('falls back to the DOM renderer after a WebGL context-loss event', async () => {
    const mountTarget = document.createElement('div');
    mountTargets.push(mountTarget);
    Object.assign(mountTarget.style, {
      position: 'absolute',
      width: '640px',
      height: '320px',
    });
    document.body.appendChild(mountTarget);

    const pty = new FrontendPty('session-webgl-context-loss');
    ptys.push(pty);
    pty.setRendererPreference('webgl');
    pty.flushPendingWrites();
    pty.mount(mountTarget, { cols: 80, rows: 20 });
    await writeTerminal(pty, 'content-survives-context-loss');

    const canvases = pty.ownedContainer.querySelectorAll<HTMLCanvasElement>('.xterm-screen canvas');
    expect(canvases.length).toBeGreaterThan(0);
    vi.useFakeTimers();
    for (const canvas of canvases) {
      canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
    }
    await vi.advanceTimersByTimeAsync(3_000);

    expect(pty.getRendererDiagnosticsEntry()).toMatchObject({
      engine: 'dom',
      issue: 'webgl-context-lost',
    });
    expect(pty.terminal.buffer.active.getLine(0)?.translateToString(true)).toBe(
      'content-survives-context-loss'
    );
  });
});
