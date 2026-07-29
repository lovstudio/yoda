import { performance } from 'node:perf_hooks';
import { describe, expect, it, vi } from 'vitest';
import type { Pty, PtyExitInfo } from './pty';
import { ptySessionRegistry } from './pty-session-registry';

vi.mock('@main/lib/logger', () => ({
  log: {
    debug: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock('@main/lib/events', () => ({
  events: {
    emit: vi.fn(),
    on: vi.fn(() => vi.fn()),
  },
}));

class PerformanceFixturePty implements Pty {
  readonly writes: string[] = [];
  private dataHandler: ((data: string) => void) | null = null;

  write(data: string): void {
    this.writes.push(data);
  }
  resize(): void {}
  kill(): void {}
  onData(handler: (data: string) => void): void {
    this.dataHandler = handler;
  }
  onExit(_handler: (info: PtyExitInfo) => void): void {}
  emitData(data: string): void {
    this.dataHandler?.(data);
  }
}

describe('20-session PTY performance regression', () => {
  it('keeps continuous input P95 below 50ms while all sessions produce output', () => {
    const sessionIds = Array.from({ length: 20 }, (_, index) => `perf:task:session-${index}`);
    const ptys = sessionIds.map(() => new PerformanceFixturePty());
    const latencies: number[] = [];
    try {
      for (let index = 0; index < sessionIds.length; index += 1) {
        ptySessionRegistry.register(sessionIds[index], ptys[index]);
      }
      for (let round = 0; round < 100; round += 1) {
        for (let index = 0; index < sessionIds.length; index += 1) {
          ptys[index].emitData(`\u001b[32moutput-${round}-${index}\u001b[0m\n`);
          const startedAt = performance.now();
          expect(ptySessionRegistry.writeOrQueue(sessionIds[index], `input-${round}\r`)).toBe(
            'written'
          );
          latencies.push(performance.now() - startedAt);
        }
      }
      latencies.sort((left, right) => left - right);
      const p95 = latencies[Math.ceil(latencies.length * 0.95) - 1];
      expect(p95).toBeLessThan(50);
      expect(ptys.every((pty) => pty.writes.length === 100)).toBe(true);
    } finally {
      for (const sessionId of sessionIds) ptySessionRegistry.unregister(sessionId);
    }
  });
});
