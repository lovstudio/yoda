import { describe, expect, it, vi } from 'vitest';
import { SESSION_PROMPTS_REFRESH_MS, startVisibleSessionRefresh } from './session-prompts';

vi.mock('@renderer/lib/ipc', () => ({ rpc: {} }));

describe('startVisibleSessionRefresh', () => {
  it('pauses while hidden and refreshes immediately when visibility returns', async () => {
    vi.useFakeTimers();
    let visible = false;
    let onVisibilityChange: (() => void) | undefined;
    const load = vi.fn(async () => {});
    const stop = startVisibleSessionRefresh(load, {
      isVisible: () => visible,
      subscribeVisibility: (listener) => {
        onVisibilityChange = listener;
        return () => {
          onVisibilityChange = undefined;
        };
      },
    });

    await vi.advanceTimersByTimeAsync(SESSION_PROMPTS_REFRESH_MS * 2);
    expect(load).not.toHaveBeenCalled();

    visible = true;
    onVisibilityChange?.();
    await Promise.resolve();
    expect(load).toHaveBeenCalledOnce();

    stop();
    vi.useRealTimers();
  });

  it('skips interval ticks while a previous transcript scan is still running', async () => {
    vi.useFakeTimers();
    let finish!: () => void;
    const load = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        })
    );
    const stop = startVisibleSessionRefresh(load, {
      isVisible: () => true,
      subscribeVisibility: () => () => {},
    });
    await Promise.resolve();
    expect(load).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(SESSION_PROMPTS_REFRESH_MS * 3);
    expect(load).toHaveBeenCalledOnce();

    finish();
    await Promise.resolve();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(SESSION_PROMPTS_REFRESH_MS);
    expect(load).toHaveBeenCalledTimes(2);

    stop();
    vi.useRealTimers();
  });
});
