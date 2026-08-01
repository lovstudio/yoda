type CachedValue<T> = {
  kind: 'value';
  value: T;
  expiresAt: number;
  lastAccessedAt: number;
};

type PendingValue<T> = {
  kind: 'pending';
  promise: Promise<T>;
  lastAccessedAt: number;
};

type CacheEntry<T> = CachedValue<T> | PendingValue<T>;

/**
 * Coalesces concurrent keyed reads and briefly reuses successful values. The
 * entry bound prevents one-off session IDs from accumulating for the lifetime
 * of the main process.
 */
export class KeyedTtlSingleFlightCache<T> {
  private readonly entries = new Map<string, CacheEntry<T>>();

  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries: number,
    private readonly now: () => number = Date.now
  ) {
    if (!Number.isFinite(ttlMs) || ttlMs < 0) {
      throw new Error('Cache TTL must be a non-negative finite number.');
    }
    if (!Number.isInteger(maxEntries) || maxEntries < 1) {
      throw new Error('Cache maxEntries must be a positive integer.');
    }
  }

  get(key: string, load: () => Promise<T>): Promise<T> {
    const now = this.now();
    const existing = this.entries.get(key);
    if (existing?.kind === 'pending') {
      existing.lastAccessedAt = now;
      return existing.promise;
    }
    if (existing?.kind === 'value' && now < existing.expiresAt) {
      existing.lastAccessedAt = now;
      return Promise.resolve(existing.value);
    }
    if (existing) this.entries.delete(key);

    const pending: PendingValue<T> = {
      kind: 'pending',
      lastAccessedAt: now,
      promise: Promise.resolve()
        .then(load)
        .then(
          (value) => {
            if (this.entries.get(key) === pending) {
              const completedAt = this.now();
              this.entries.set(key, {
                kind: 'value',
                value,
                expiresAt: completedAt + this.ttlMs,
                lastAccessedAt: completedAt,
              });
            }
            return value;
          },
          (error: unknown) => {
            if (this.entries.get(key) === pending) this.entries.delete(key);
            throw error;
          }
        ),
    };
    this.entries.set(key, pending);
    this.evictOverflow(now);
    return pending.promise;
  }

  clear(): void {
    this.entries.clear();
  }

  private evictOverflow(now: number): void {
    for (const [key, entry] of this.entries) {
      if (entry.kind === 'value' && now >= entry.expiresAt) this.entries.delete(key);
    }
    while (this.entries.size > this.maxEntries) {
      let oldestKey: string | undefined;
      let oldestAccess = Number.POSITIVE_INFINITY;
      for (const [key, entry] of this.entries) {
        if (entry.lastAccessedAt < oldestAccess) {
          oldestKey = key;
          oldestAccess = entry.lastAccessedAt;
        }
      }
      if (oldestKey === undefined) return;
      this.entries.delete(oldestKey);
    }
  }
}
