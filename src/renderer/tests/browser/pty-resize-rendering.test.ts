import { afterEach, describe, expect, it, vi } from 'vitest';
import '@xterm/xterm/css/xterm.css';
import '@renderer/index.css';
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
      subscribe: vi.fn(async () => ({
        success: true,
        data: { buffer: '', generation: 1, sequence: 0 },
      })),
      unsubscribe: vi.fn(() => Promise.resolve()),
      acknowledgeOutput: vi.fn(() => Promise.resolve()),
      heartbeatConsumer: vi.fn(() => Promise.resolve()),
    },
  },
}));

function writeTerminal(pty: FrontendPty, data: string): Promise<void> {
  return new Promise((resolve) => pty.terminal.write(data, resolve));
}

async function nextAnimationFrame(): Promise<void> {
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

function visibleBufferText(pty: FrontendPty): string {
  return Array.from({ length: pty.terminal.buffer.active.length }, (_, row) =>
    pty.terminal.buffer.active.getLine(row)?.translateToString(true)
  ).join('\n');
}

describe('FrontendPty canonical DOM rendering', () => {
  let pty: FrontendPty | null = null;
  let mountTarget: HTMLDivElement | null = null;

  afterEach(() => {
    pty?.dispose();
    pty = null;
    mountTarget?.remove();
    mountTarget = null;
  });

  it('uses one DOM-backed scene without a resize snapshot layer', async () => {
    pty = new FrontendPty('session-dom-scene');
    mountTarget = document.createElement('div');
    Object.assign(mountTarget.style, { width: '900px', height: '420px' });
    document.body.appendChild(mountTarget);
    pty.flushPendingWrites();
    pty.mount(mountTarget, { cols: 120, rows: 32 });
    await writeTerminal(pty, 'canonical scene');
    await nextAnimationFrame();

    expect(pty.ownedContainer.querySelector('.xterm-rows')).not.toBeNull();
    expect(pty.ownedContainer.querySelector('.terminal-freeze-overlay')).toBeNull();
    expect(pty.ownedContainer.querySelector('.xterm-rows canvas')).toBeNull();
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

  it('preserves CJK, emoji and accented text through rapid shrink/grow transitions', async () => {
    pty = new FrontendPty('session-resize-content');
    pty.flushPendingWrites();
    mountTarget = document.createElement('div');
    Object.assign(mountTarget.style, { width: '900px', height: '420px' });
    document.body.appendChild(mountTarget);
    pty.mount(mountTarget, { cols: 120, rows: 32 });
    await writeTerminal(pty, '标题：终端稳定性 🧭\r\n第二行 café résumé\r\n');

    for (const [cols, rows] of [
      [48, 10],
      [150, 38],
      [62, 14],
      [120, 32],
    ] as const) {
      pty.commitResize(cols, rows);
    }
    await nextAnimationFrame();

    expect(pty.terminal.cols).toBe(120);
    expect(pty.terminal.rows).toBe(32);
    expect(visibleBufferText(pty)).toContain('标题：终端稳定性 🧭');
    expect(visibleBufferText(pty)).toContain('第二行 café résumé');
    expect(pty.ownedContainer.querySelector('.terminal-freeze-overlay')).toBeNull();
  });

  it('does not hide or force-refresh the terminal scene during resize', async () => {
    pty = new FrontendPty('session-resize-no-content-rerender');
    pty.flushPendingWrites();
    mountTarget = document.createElement('div');
    Object.assign(mountTarget.style, { width: '900px', height: '420px' });
    document.body.appendChild(mountTarget);
    pty.mount(mountTarget, { cols: 120, rows: 32 });
    await pty.connect();
    await expect(pty.waitForVisibleFrame()).resolves.toBe(true);
    await writeTerminal(pty, 'stable conversation content');
    const refresh = vi.spyOn(pty.terminal, 'refresh');

    pty.commitResize(96, 24);

    expect(pty.ownedContainer.style.visibility).toBe('');
    expect(refresh).not.toHaveBeenCalled();
    expect(visibleBufferText(pty)).toContain('stable conversation content');
  });

  it('clears rewritten rows on an opaque session-themed surface during first resize', async () => {
    const background = '#f0edeb';
    pty = new FrontendPty('session-first-resize-row-clearing', {
      override: {
        background,
        foreground: '#202020',
        cursor: '#202020',
      },
    });
    pty.flushPendingWrites();
    mountTarget = document.createElement('div');
    Object.assign(mountTarget.style, { width: '900px', height: '420px' });
    document.body.appendChild(mountTarget);
    pty.mount(mountTarget, { cols: 120, rows: 32 });

    const staleLine = 'stale row must be erased after the first layout pass';
    const finalLine = 'Hip，时长 02:45。现在按精确片段反查原始发布页。';
    await writeTerminal(pty, `${staleLine}\r\n`);
    await nextAnimationFrame();
    await writeTerminal(pty, `\x1b[2J\x1b[H${finalLine}`);
    pty.commitResize(139, 50);
    await nextAnimationFrame();
    await nextAnimationFrame();

    const rows = pty.ownedContainer.querySelector<HTMLElement>('.xterm-rows');
    const viewport = pty.ownedContainer.querySelector<HTMLElement>('.xterm-viewport');
    if (!rows || !viewport) throw new Error('xterm DOM renderer was not mounted');

    expect(getComputedStyle(rows).backgroundColor).toBe('rgb(240, 237, 235)');
    expect(getComputedStyle(viewport).backgroundColor).toBe('rgb(240, 237, 235)');
    expect(rows.textContent).not.toContain(staleLine);
    expect(rows.textContent?.split(finalLine)).toHaveLength(2);
    expect(visibleBufferText(pty).split(finalLine)).toHaveLength(2);
  });

  it('keeps the hidden parser current while xterm pauses off-screen DOM rendering', async () => {
    pty = new FrontendPty('session-hidden-parser-visible-renderer');
    pty.flushPendingWrites();
    mountTarget = document.createElement('div');
    Object.assign(mountTarget.style, { width: '900px', height: '420px' });
    document.body.appendChild(mountTarget);
    const firstLease = pty.mount(mountTarget, { cols: 120, rows: 32 });
    await pty.connect();
    await expect(pty.waitForVisibleFrame()).resolves.toBe(true);

    let renderCount = 0;
    const renderSubscription = pty.terminal.onRender(() => {
      renderCount += 1;
    });
    pty.unmount(firstLease);
    await nextAnimationFrame();
    await nextAnimationFrame();
    const renderCountBeforeHiddenWrite = renderCount;

    await writeTerminal(pty, 'hidden parser remains current');
    await nextAnimationFrame();
    await nextAnimationFrame();

    expect(visibleBufferText(pty)).toContain('hidden parser remains current');
    expect(renderCount).toBe(renderCountBeforeHiddenWrite);

    pty.mount(mountTarget, { cols: 120, rows: 32 });
    await nextAnimationFrame();
    await nextAnimationFrame();
    expect(renderCount).toBeGreaterThan(renderCountBeforeHiddenWrite);
    renderSubscription.dispose();
  });

  it('never exposes stale off-screen DOM rows while a hot terminal remounts', async () => {
    pty = new FrontendPty('session-hot-remount-frame-commit');
    pty.flushPendingWrites();
    mountTarget = document.createElement('div');
    Object.assign(mountTarget.style, { width: '900px', height: '420px' });
    document.body.appendChild(mountTarget);
    const firstLease = pty.mount(mountTarget, { cols: 120, rows: 32 });
    await pty.connect();
    await expect(pty.waitForVisibleFrame()).resolves.toBe(true);

    const staleLine = 'stale visible frame must never be exposed on remount';
    const canonicalLine = 'canonical hidden parser frame';
    await writeTerminal(pty, staleLine);
    pty.unmount(firstLease);
    await nextAnimationFrame();
    await nextAnimationFrame();
    await writeTerminal(pty, `\x1b[2J\x1b[H${canonicalLine}`);

    const remountStartedAt = performance.now();
    pty.mount(mountTarget, { cols: 120, rows: 32 });

    expect(pty.ownedContainer.style.visibility).toBe('hidden');
    await expect(pty.waitForVisibleFrame()).resolves.toBe(true);
    expect(performance.now() - remountStartedAt).toBeLessThan(200);
    expect(pty.ownedContainer.style.visibility).toBe('');
    expect(visibleBufferText(pty)).toContain(canonicalLine);
    expect(visibleBufferText(pty)).not.toContain(staleLine);
    expect(pty.ownedContainer.querySelector('.xterm-rows')?.textContent).toContain(canonicalLine);
    expect(pty.ownedContainer.querySelector('.xterm-rows')?.textContent).not.toContain(staleLine);
  });

  it('keeps CJK punctuation and final wide glyphs inside the DOM row grid', async () => {
    pty = new FrontendPty('session-cjk-row-width');
    pty.flushPendingWrites();
    mountTarget = document.createElement('div');
    Object.assign(mountTarget.style, { width: '1100px', height: '420px' });
    document.body.appendChild(mountTarget);
    pty.mount(mountTarget, { cols: 127, rows: 24 });

    await writeTerminal(
      pty,
      '• 合并后的实时 TTY 仍保持 127 列，说明外层与挂载容器在当前页面恰好同宽，刚才的改动修正了测量优先级，但还没命中这张截图的实际差值。'
    );
    await nextAnimationFrame();

    const rows = Array.from(pty.ownedContainer.querySelectorAll<HTMLElement>('.xterm-rows > div'));
    const firstRow = rows.find((row) => row.textContent?.includes('合并后的实时'));

    expect(firstRow).toBeDefined();
    expect(firstRow?.textContent).toContain('实际差');
    expect(firstRow?.scrollWidth).toBeLessThanOrEqual(firstRow?.clientWidth ?? 0);
    expect(getComputedStyle(pty.terminal.element!).getPropertyValue('text-spacing-trim')).toBe(
      'space-all'
    );
  });

  it('reparents the same canonical scene without losing its buffer', async () => {
    pty = new FrontendPty('session-reparent-buffer');
    pty.flushPendingWrites();
    const firstTarget = document.createElement('div');
    const secondTarget = document.createElement('div');
    document.body.append(firstTarget, secondTarget);
    mountTarget = secondTarget;

    const firstLease = pty.mount(firstTarget, { cols: 100, rows: 24 });
    await writeTerminal(pty, 'persistent 中文 buffer');
    pty.unmount(firstLease);
    const secondLease = pty.mount(secondTarget, { cols: 132, rows: 30 });
    await nextAnimationFrame();

    expect(pty.ownedContainer.parentElement).toBe(secondTarget);
    expect(visibleBufferText(pty)).toContain('persistent 中文 buffer');
    expect(secondTarget.querySelectorAll('.xterm-rows').length).toBe(1);
    pty.unmount(secondLease);
    firstTarget.remove();
  });
});
