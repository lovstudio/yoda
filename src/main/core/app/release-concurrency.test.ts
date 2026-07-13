import { describe, expect, it } from 'vitest';
import { runWithConcurrency } from '@root/scripts/release/lib/concurrency';

describe('release upload concurrency', () => {
  it('limits active uploads while processing every item', async () => {
    let active = 0;
    let peak = 0;
    const completed: number[] = [];

    await runWithConcurrency([1, 2, 3, 4, 5], 2, async (item) => {
      active += 1;
      peak = Math.max(peak, active);
      await Promise.resolve();
      completed.push(item);
      active -= 1;
    });

    expect(peak).toBe(2);
    expect(completed.sort()).toEqual([1, 2, 3, 4, 5]);
  });

  it('rejects invalid concurrency', async () => {
    await expect(runWithConcurrency([1], 0, async () => undefined)).rejects.toThrow(
      'Concurrency must be a positive integer'
    );
  });
});
