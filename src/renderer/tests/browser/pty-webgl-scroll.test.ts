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

describe('FrontendPty WebGL scrolling', () => {
  let pty: FrontendPty | null = null;
  let mountTarget: HTMLDivElement | null = null;

  afterEach(() => {
    pty?.dispose();
    pty = null;
    mountTarget?.remove();
    mountTarget = null;
  });

  it('renders every visible row once after sustained output scrolling', async () => {
    mountTarget = document.createElement('div');
    Object.assign(mountTarget.style, {
      position: 'absolute',
      left: '0',
      top: '0',
      width: '900px',
      height: '420px',
      background: '#ffffff',
    });
    document.body.appendChild(mountTarget);

    pty = new FrontendPty('session-webgl-visual', {
      override: {
        background: '#ffffff',
        foreground: '#111111',
        cursor: '#111111',
      },
    });
    pty.setRendererPreference('webgl');
    expect(pty.getRendererDiagnosticsEntry().engine).toBe('webgl');
    pty.flushPendingWrites();
    pty.mount(mountTarget, { cols: 80, rows: 24 });

    await writeTerminal(
      pty,
      Array.from({ length: 100 }, (_, index) => `${uniqueRow(index)}\r\n`).join('')
    );
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
});
