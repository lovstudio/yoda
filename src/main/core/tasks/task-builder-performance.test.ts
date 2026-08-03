import { describe, expect, it, vi } from 'vitest';
import type { Terminal } from '@shared/terminals';
import type { TerminalProvider } from '@main/core/terminals/terminal-provider';
import { hydratePersistedTerminals, TERMINAL_HYDRATION_CONCURRENCY } from './terminal-hydration';

describe('persisted terminal hydration', () => {
  it('bounds concurrent PTY startup work', async () => {
    let active = 0;
    let maxActive = 0;
    const spawnTerminal = vi.fn(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise<void>((resolve) => setTimeout(resolve, 1));
      active -= 1;
    });
    const provider = { spawnTerminal } as unknown as TerminalProvider;
    const terminals = Array.from(
      { length: 13 },
      (_, index): Terminal => ({
        id: `terminal-${index}`,
        projectId: 'project-1',
        taskId: 'task-1',
        name: `Terminal ${index + 1}`,
      })
    );

    await hydratePersistedTerminals(provider, terminals, 'test');

    expect(spawnTerminal).toHaveBeenCalledTimes(terminals.length);
    expect(maxActive).toBe(TERMINAL_HYDRATION_CONCURRENCY);
  });

  it('continues hydrating later terminals when one spawn never settles', async () => {
    vi.useFakeTimers();
    try {
      const spawnTerminal = vi.fn((trackedTerminal: Terminal) => {
        if (trackedTerminal.id === 'terminal-0') return new Promise<void>(() => {});
        return Promise.resolve();
      });
      const provider = { spawnTerminal } as unknown as TerminalProvider;
      const terminals = Array.from(
        { length: 8 },
        (_, index): Terminal => ({
          id: `terminal-${index}`,
          projectId: 'project-1',
          taskId: 'task-1',
          name: `Terminal ${index + 1}`,
        })
      );

      const hydration = hydratePersistedTerminals(provider, terminals, 'test', { timeoutMs: 10 });
      await vi.advanceTimersByTimeAsync(0);

      expect(spawnTerminal).toHaveBeenCalledTimes(terminals.length);
      await vi.advanceTimersByTimeAsync(10);
      await hydration;
    } finally {
      vi.useRealTimers();
    }
  });
});
