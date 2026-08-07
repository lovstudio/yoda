const DEFAULT_RECEIPT_TTL_MS = 2 * 60_000;
const DEFAULT_MAX_RECEIPTS = 256;

type Receipt<T> = {
  expiresAt: number;
  promise: Promise<T>;
  settled: boolean;
  signature: string;
};

export class MobileSessionInputRequestConflictError extends Error {}

/**
 * Keeps a short-lived receipt for mobile sends. A phone may lose the HTTP
 * response after the prompt reached the PTY; retrying the same request id must
 * return the original result instead of injecting a duplicate turn.
 */
export class MobileSessionInputRequestCache<T> {
  private readonly receipts = new Map<string, Receipt<T>>();

  constructor(
    private readonly now: () => number = Date.now,
    private readonly receiptTtlMs = DEFAULT_RECEIPT_TTL_MS,
    private readonly maxReceipts = DEFAULT_MAX_RECEIPTS
  ) {}

  run(key: string, signature: string, execute: () => Promise<T>): Promise<T> {
    this.reapExpired();
    const existing = this.receipts.get(key);
    if (existing) {
      if (existing.signature !== signature) {
        throw new MobileSessionInputRequestConflictError(
          'The mobile request id was reused with different input.'
        );
      }
      return existing.promise;
    }

    const promise = execute();
    const receipt: Receipt<T> = {
      expiresAt: Number.POSITIVE_INFINITY,
      promise,
      settled: false,
      signature,
    };
    this.receipts.set(key, receipt);
    void promise.then(
      () => {
        if (this.receipts.get(key) !== receipt) return;
        receipt.settled = true;
        receipt.expiresAt = this.now() + this.receiptTtlMs;
        this.trimToLimit();
      },
      () => {
        if (this.receipts.get(key) === receipt) this.receipts.delete(key);
      }
    );
    this.trimToLimit();
    return promise;
  }

  clear(): void {
    this.receipts.clear();
  }

  private reapExpired(): void {
    const now = this.now();
    for (const [key, receipt] of this.receipts) {
      if (receipt.settled && receipt.expiresAt <= now) this.receipts.delete(key);
    }
  }

  private trimToLimit(): void {
    while (this.receipts.size > this.maxReceipts) {
      const oldestKey = [...this.receipts].find(([, receipt]) => receipt.settled)?.[0];
      if (!oldestKey) return;
      this.receipts.delete(oldestKey);
    }
  }
}
