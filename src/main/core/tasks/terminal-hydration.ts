import type { Terminal } from '@shared/terminals';
import {
  TERMINAL_SPAWN_TIMEOUT_MS,
  TerminalSpawnTimeoutError,
  type TerminalProvider,
} from '@main/core/terminals/terminal-provider';
import { log } from '@main/lib/logger';

export const TERMINAL_HYDRATION_CONCURRENCY = 4;

type HydrationLimiter = {
  active: number;
  queue: Array<() => void>;
};

const hydrationLimiters = new Map<string, HydrationLimiter>();

function acquireHydrationSlot(key: string): Promise<() => void> {
  const limiter = hydrationLimiters.get(key) ?? { active: 0, queue: [] };
  hydrationLimiters.set(key, limiter);

  return new Promise((resolve) => {
    const start = () => {
      limiter.active += 1;
      let released = false;
      resolve(() => {
        if (released) return;
        released = true;
        limiter.active -= 1;
        const next = limiter.queue.shift();
        if (next) {
          next();
        } else if (limiter.active === 0 && hydrationLimiters.get(key) === limiter) {
          hydrationLimiters.delete(key);
        }
      });
    };

    if (limiter.active < TERMINAL_HYDRATION_CONCURRENCY) {
      start();
    } else {
      limiter.queue.push(start);
    }
  });
}

async function withHydrationSlot<T>(key: string, run: () => Promise<T>): Promise<T> {
  const release = await acquireHydrationSlot(key);
  try {
    return await run();
  } finally {
    release();
  }
}

export async function hydratePersistedTerminals(
  provider: TerminalProvider,
  terminals: Terminal[],
  logPrefix: string,
  options: { timeoutMs?: number; shouldHydrate?: (terminal: Terminal) => boolean } = {}
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? TERMINAL_SPAWN_TIMEOUT_MS;
  const concurrencyKey = provider.terminalHydrationConcurrencyKey ?? 'terminal:default';
  let nextIndex = 0;

  const hydrateNext = async (): Promise<void> => {
    while (nextIndex < terminals.length) {
      const terminal = terminals[nextIndex++];
      await withHydrationSlot(concurrencyKey, async () => {
        // Re-check after waiting for a shared slot. A terminal can be deleted or
        // detached while another task on the same SSH connection is hydrating.
        if (options.shouldHydrate && !options.shouldHydrate(terminal)) return;
        const controller = new AbortController();
        let timer: ReturnType<typeof setTimeout> | undefined;
        const timeoutError = new TerminalSpawnTimeoutError(terminal.id, timeoutMs);
        const timeout = new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            controller.abort(timeoutError);
            reject(timeoutError);
          }, timeoutMs);
          timer.unref?.();
        });

        try {
          await Promise.race([
            provider.spawnTerminal(terminal, undefined, undefined, {
              signal: controller.signal,
              timeoutMs,
            }),
            timeout,
          ]);
        } catch (error) {
          log.error(`${logPrefix}: failed to hydrate terminal`, {
            terminalId: terminal.id,
            error: String(error),
          });
        } finally {
          if (timer) clearTimeout(timer);
        }
      });
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(TERMINAL_HYDRATION_CONCURRENCY, terminals.length) }, hydrateNext)
  );
}
