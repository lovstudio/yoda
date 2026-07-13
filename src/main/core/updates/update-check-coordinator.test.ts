import { afterEach, describe, expect, it, vi } from 'vitest';
import { UpdateCheckCoordinator, UpdateCheckTimeoutError } from './update-check-coordinator';

describe('UpdateCheckCoordinator', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('aborts a hung check, reports the timeout, and allows a retry', async () => {
    vi.useFakeTimers();
    const coordinator = new UpdateCheckCoordinator<string>(30_000);
    const errors: unknown[] = [];
    const settled = vi.fn();
    let firstSignal: AbortSignal | undefined;

    const first = coordinator.run(
      async (signal) => {
        firstSignal = signal;
        return await new Promise<string>(() => {});
      },
      (error) => errors.push(error),
      settled
    );

    const duplicate = coordinator.run(
      async () => 'must not start',
      (error) => errors.push(error),
      settled
    );
    expect(duplicate).toBe(first);

    const rejection = expect(first).rejects.toBeInstanceOf(UpdateCheckTimeoutError);
    await vi.advanceTimersByTimeAsync(30_000);

    await rejection;
    expect(firstSignal?.aborted).toBe(true);
    expect(errors).toHaveLength(1);
    expect(settled).toHaveBeenCalledTimes(1);

    await expect(coordinator.run(async () => 'retried', vi.fn(), settled)).resolves.toBe('retried');
    expect(settled).toHaveBeenCalledTimes(2);
  });

  it('does not report an error for a successful check', async () => {
    const coordinator = new UpdateCheckCoordinator<string>(30_000);
    const onError = vi.fn();
    const onSettled = vi.fn();

    await expect(coordinator.run(async () => 'ok', onError, onSettled)).resolves.toBe('ok');

    expect(onError).not.toHaveBeenCalled();
    expect(onSettled).toHaveBeenCalledOnce();
  });

  it('settles a hung check during disposal without reporting a user-facing failure', async () => {
    vi.useFakeTimers();
    const coordinator = new UpdateCheckCoordinator<string>(30_000);
    const onError = vi.fn();
    const onSettled = vi.fn();
    const check = coordinator.run(
      async () => await new Promise<string>(() => {}),
      onError,
      onSettled
    );
    const rejection = expect(check).rejects.toThrow('Update service disposed');

    coordinator.dispose();
    await rejection;
    await vi.advanceTimersByTimeAsync(30_000);

    expect(onError).not.toHaveBeenCalled();
    expect(onSettled).not.toHaveBeenCalled();
  });
});
