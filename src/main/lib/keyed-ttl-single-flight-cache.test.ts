import { describe, expect, it, vi } from 'vitest';
import { KeyedTtlSingleFlightCache } from './keyed-ttl-single-flight-cache';

describe('KeyedTtlSingleFlightCache', () => {
  it('coalesces concurrent reads and starts its TTL when loading completes', async () => {
    let now = 1_000;
    let finish!: (value: number) => void;
    const load = vi.fn(
      () =>
        new Promise<number>((resolve) => {
          finish = resolve;
        })
    );
    const cache = new KeyedTtlSingleFlightCache<number>(2_000, 8, () => now);

    const first = cache.get('session', load);
    const second = cache.get('session', load);
    await Promise.resolve();
    expect(load).toHaveBeenCalledOnce();

    now = 1_500;
    finish(7);
    await expect(Promise.all([first, second])).resolves.toEqual([7, 7]);

    now = 3_499;
    await expect(cache.get('session', async () => 8)).resolves.toBe(7);
    now = 3_500;
    await expect(cache.get('session', async () => 8)).resolves.toBe(8);
  });

  it('does not cache failures or let a cleared in-flight read repopulate the cache', async () => {
    const cache = new KeyedTtlSingleFlightCache<number>(2_000, 8, () => 0);

    await expect(
      cache.get('failure', async () => Promise.reject(new Error('boom')))
    ).rejects.toThrow('boom');
    await expect(cache.get('failure', async () => 1)).resolves.toBe(1);

    let finish!: (value: number) => void;
    const pending = cache.get(
      'pending',
      () =>
        new Promise<number>((resolve) => {
          finish = resolve;
        })
    );
    await Promise.resolve();
    cache.clear();
    finish(2);
    await expect(pending).resolves.toBe(2);
    await expect(cache.get('pending', async () => 3)).resolves.toBe(3);
  });

  it('evicts the least recently used completed entry at the configured bound', async () => {
    let now = 0;
    const cache = new KeyedTtlSingleFlightCache<number>(10_000, 2, () => now);
    await cache.get('first', async () => 1);
    now = 1;
    await cache.get('second', async () => 2);
    now = 2;
    await cache.get('first', async () => 10);
    now = 3;
    await cache.get('third', async () => 3);

    const reloadFirst = vi.fn(async () => 10);
    await expect(cache.get('first', reloadFirst)).resolves.toBe(1);
    expect(reloadFirst).not.toHaveBeenCalled();

    const reloadSecond = vi.fn(async () => 20);
    await expect(cache.get('second', reloadSecond)).resolves.toBe(20);
    expect(reloadSecond).toHaveBeenCalledOnce();
  });
});
