import type { Client } from 'ssh2';

const MAX_CONCURRENT_OPENS = 4;

type OpenLimiter = {
  active: number;
  queue: Array<() => void>;
};

const openLimiters = new WeakMap<Client, OpenLimiter>();

/**
 * Bound the ssh2 channel opens that are actually pending on one Client.
 *
 * Callers must keep the slot until ssh2 invokes the channel-open callback.
 * A caller that becomes stale while queued should still acquire and release
 * its slot, but skip starting another channel open.
 */
export function acquireSshTerminalOpenSlot(client: Client): Promise<() => void> {
  const limiter = openLimiters.get(client) ?? { active: 0, queue: [] };
  openLimiters.set(client, limiter);

  return new Promise((resolve) => {
    const grant = () => {
      limiter.active += 1;
      let released = false;
      resolve(() => {
        if (released) return;
        released = true;
        limiter.active -= 1;

        const next = limiter.queue.shift();
        if (next) {
          next();
        } else if (limiter.active === 0 && openLimiters.get(client) === limiter) {
          openLimiters.delete(client);
        }
      });
    };

    if (limiter.active < MAX_CONCURRENT_OPENS) {
      grant();
    } else {
      limiter.queue.push(grant);
    }
  });
}
