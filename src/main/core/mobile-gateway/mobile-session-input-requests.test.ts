import { describe, expect, it, vi } from 'vitest';
import {
  MobileSessionInputRequestCache,
  MobileSessionInputRequestConflictError,
} from './mobile-session-input-requests';

describe('MobileSessionInputRequestCache', () => {
  it('returns the original result when a delivered mobile request is retried', async () => {
    const execute = vi.fn(async () => ({ ok: true as const }));
    const cache = new MobileSessionInputRequestCache();

    await expect(cache.run('session:request', 'same-input', execute)).resolves.toEqual({
      ok: true,
    });
    await expect(cache.run('session:request', 'same-input', execute)).resolves.toEqual({
      ok: true,
    });

    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('shares an in-flight send across concurrent retries', async () => {
    let resolveSend: ((value: string) => void) | undefined;
    const execute = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          resolveSend = resolve;
        })
    );
    const cache = new MobileSessionInputRequestCache<string>();

    const first = cache.run('session:request', 'same-input', execute);
    const retry = cache.run('session:request', 'same-input', execute);
    resolveSend?.('accepted');

    await expect(Promise.all([first, retry])).resolves.toEqual(['accepted', 'accepted']);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('allows a failed request to be attempted again', async () => {
    const execute = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error('transient'))
      .mockResolvedValueOnce('accepted');
    const cache = new MobileSessionInputRequestCache<string>();

    await expect(cache.run('session:request', 'same-input', execute)).rejects.toThrow('transient');
    await expect(cache.run('session:request', 'same-input', execute)).resolves.toBe('accepted');
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it('rejects accidental request id reuse with different content', async () => {
    const cache = new MobileSessionInputRequestCache<string>();
    await cache.run('session:request', 'first-input', async () => 'accepted');

    expect(() => cache.run('session:request', 'second-input', async () => 'other')).toThrow(
      MobileSessionInputRequestConflictError
    );
  });

  it('allows the same request id after its receipt expires', async () => {
    let now = 0;
    const execute = vi.fn(async () => 'accepted');
    const cache = new MobileSessionInputRequestCache<string>(() => now, 100);

    await cache.run('session:request', 'same-input', execute);
    now = 101;
    await cache.run('session:request', 'same-input', execute);

    expect(execute).toHaveBeenCalledTimes(2);
  });

  it('never expires a request while its first delivery is still running', async () => {
    let now = 0;
    let resolveSend: ((value: string) => void) | undefined;
    const execute = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          resolveSend = resolve;
        })
    );
    const cache = new MobileSessionInputRequestCache<string>(() => now, 100);

    const first = cache.run('session:request', 'same-input', execute);
    now = 1_000;
    const retry = cache.run('session:request', 'same-input', execute);
    resolveSend?.('accepted');

    await expect(Promise.all([first, retry])).resolves.toEqual(['accepted', 'accepted']);
    expect(execute).toHaveBeenCalledTimes(1);
  });
});
