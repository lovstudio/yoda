import { afterEach, describe, expect, it, vi } from 'vitest';
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
