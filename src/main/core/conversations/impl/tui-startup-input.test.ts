import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Pty, PtyExitInfo } from '@main/core/pty/pty';
import { injectTuiStartupInput } from './tui-startup-input';

class FakePty implements Pty {
  private readonly dataHandlers: Array<(data: string) => void> = [];
  private readonly exitHandlers: Array<(info: PtyExitInfo) => void> = [];
  readonly writes: string[] = [];

  write(data: string): void {
    this.writes.push(data);
  }

  resize(): void {}

  pause(): void {}

  resume(): void {}

  kill(): void {}

  onData(handler: (data: string) => void): void {
    this.dataHandlers.push(handler);
  }

  onExit(handler: (info: PtyExitInfo) => void): void {
    this.exitHandlers.push(handler);
  }

  emitData(data: string): void {
    for (const handler of this.dataHandlers) handler(data);
  }

  emitExit(): void {
    for (const handler of this.exitHandlers) handler({ exitCode: 0 });
  }
}

describe('injectTuiStartupInput', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('waits for a quiet TUI, pastes the Plan command, and submits it', async () => {
    const pty = new FakePty();
    const result = injectTuiStartupInput({
      pty,
      runtimeId: 'codex',
      input: '/plan Inspect the repository\nand propose a plan',
    });

    pty.emitData('booting');
    await vi.advanceTimersByTimeAsync(699);
    expect(pty.writes).toEqual([]);

    await vi.advanceTimersByTimeAsync(1);
    expect(pty.writes).toEqual([
      '\u001b[200~/plan Inspect the repository\nand propose a plan\u001b[201~',
    ]);

    await vi.advanceTimersByTimeAsync(300);
    await expect(result).resolves.toBe(true);
    expect(pty.writes).toEqual([
      '\u001b[200~/plan Inspect the repository\nand propose a plan\u001b[201~',
      '\r',
    ]);
  });

  it('does not write startup input after the PTY exits', async () => {
    const pty = new FakePty();
    const result = injectTuiStartupInput({ pty, runtimeId: 'codex', input: '/plan' });

    pty.emitExit();

    await expect(result).resolves.toBe(false);
    expect(pty.writes).toEqual([]);
  });
});
