import { describe, expect, it, vi } from 'vitest';
import { UpdateCheckRecoveryGate } from './update-check-recovery-gate';

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe('UpdateCheckRecoveryGate', () => {
  it.each(['connections-first', 'operation-first'] as const)(
    'waits for closed connections and the stale operation (%s)',
    async (settlementOrder) => {
      const gate = new UpdateCheckRecoveryGate<string>();
      const staleOperation = deferred<string>();
      const resetConnections = deferred<void>();
      const retry = vi.fn();

      void gate.track(staleOperation.promise);
      gate.begin(() => resetConnections.promise, vi.fn());
      const waiting = gate.wait().then(retry);

      if (settlementOrder === 'connections-first') {
        resetConnections.resolve();
        await Promise.resolve();
        expect(retry).not.toHaveBeenCalled();
        staleOperation.reject(new Error('request aborted'));
      } else {
        staleOperation.reject(new Error('request aborted'));
        await Promise.resolve();
        expect(retry).not.toHaveBeenCalled();
        resetConnections.resolve();
      }

      await waiting;
      expect(retry).toHaveBeenCalledOnce();
    }
  );

  it('keeps the first recovery when another timeout occurs while retrying', async () => {
    const gate = new UpdateCheckRecoveryGate<string>();
    const staleOperation = deferred<string>();
    const resetConnections = deferred<void>();
    const secondReset = vi.fn(async () => {});

    void gate.track(staleOperation.promise);
    gate.begin(() => resetConnections.promise, vi.fn());
    void gate.track(gate.wait().then(() => 'retry'));
    gate.begin(secondReset, vi.fn());

    expect(secondReset).not.toHaveBeenCalled();
    staleOperation.reject(new Error('request aborted'));
    resetConnections.resolve();
    await gate.wait();
  });
});
