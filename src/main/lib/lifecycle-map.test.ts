import { describe, expect, it, vi } from 'vitest';
import { err, ok } from '@shared/result';
import { LifecycleMap } from './lifecycle-map';

describe('LifecycleMap teardown races', () => {
  it('queues teardown behind an in-flight provision and removes the late value', async () => {
    const postTeardown = vi.fn();
    const lifecycle = new LifecycleMap<{ id: string }, string>({ postTeardown });
    let finishProvision!: () => void;
    const provision = lifecycle.provision(
      'task-1',
      () =>
        new Promise((resolve) => {
          finishProvision = () => resolve(ok({ id: 'task-1' }));
        })
    );
    const runTeardown = vi.fn(async () => ok<void>());
    const teardown = lifecycle.teardown('task-1', runTeardown);
    expect(teardown).not.toBeNull();

    await Promise.resolve();
    finishProvision();
    await expect(provision).resolves.toEqual(ok({ id: 'task-1' }));
    await expect(teardown).resolves.toEqual(ok<void>());

    expect(runTeardown).toHaveBeenCalledWith({ id: 'task-1' });
    expect(postTeardown).toHaveBeenCalledWith('task-1', { id: 'task-1' });
    expect(lifecycle.get('task-1')).toBeUndefined();
  });

  it('settles queued teardown without running cleanup when provision fails', async () => {
    const lifecycle = new LifecycleMap<{ id: string }, string>();
    let finishProvision!: () => void;
    const provision = lifecycle.provision(
      'task-1',
      () =>
        new Promise((resolve) => {
          finishProvision = () => resolve(err('failed'));
        })
    );
    const runTeardown = vi.fn(async () => ok<void>());
    const teardown = lifecycle.teardown('task-1', runTeardown);

    await Promise.resolve();
    finishProvision();
    await expect(provision).resolves.toEqual(err('failed'));
    await expect(teardown).resolves.toEqual(ok<void>());
    expect(runTeardown).not.toHaveBeenCalled();
  });

  it('still cleans an activated value when a post-provision hook rejects', async () => {
    const lifecycle = new LifecycleMap<{ id: string }, string>({
      postProvision: async () => Promise.reject(new Error('hook failed')),
    });
    const provision = lifecycle.provision('task-1', async () => ok({ id: 'task-1' }));
    const runTeardown = vi.fn(async () => ok<void>());
    const teardown = lifecycle.teardown('task-1', runTeardown);

    await expect(provision).rejects.toThrow('hook failed');
    await expect(teardown).resolves.toEqual(ok<void>());
    expect(runTeardown).toHaveBeenCalledOnce();
    expect(lifecycle.get('task-1')).toBeUndefined();
  });
});
