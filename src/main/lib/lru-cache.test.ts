import { describe, expect, it } from 'vitest';
import { LruCache } from './lru-cache';

describe('LruCache', () => {
  it('evicts the least recently used entry at the configured bound', () => {
    const cache = new LruCache<string, number>(2);
    cache.set('first', 1);
    cache.set('second', 2);
    expect(cache.get('first')).toBe(1);

    cache.set('third', 3);

    expect(cache.size).toBe(2);
    expect(cache.get('first')).toBe(1);
    expect(cache.get('second')).toBeUndefined();
    expect(cache.get('third')).toBe(3);
  });

  it('refreshes recency when replacing an existing key', () => {
    const cache = new LruCache<string, string>(2);
    cache.set('first', 'old');
    cache.set('second', 'value');
    cache.set('first', 'new');
    cache.set('third', 'value');

    expect(cache.get('first')).toBe('new');
    expect(cache.get('second')).toBeUndefined();
  });
});
