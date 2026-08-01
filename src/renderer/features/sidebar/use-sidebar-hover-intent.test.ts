import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createSidebarHoverIntent,
  SIDEBAR_HOVER_INTENT_DELAY_MS,
} from './use-sidebar-hover-intent';

describe('sidebar hover intent', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps incidental row crossings out of the scroll path', () => {
    vi.useFakeTimers();
    const onIntent = vi.fn();
    const intent = createSidebarHoverIntent(onIntent);

    intent.schedule();
    vi.advanceTimersByTime(SIDEBAR_HOVER_INTENT_DELAY_MS - 1);
    expect(onIntent).not.toHaveBeenCalled();

    intent.cancel();
    vi.advanceTimersByTime(SIDEBAR_HOVER_INTENT_DELAY_MS);
    expect(onIntent).not.toHaveBeenCalled();
  });

  it('prefetches after the pointer deliberately rests on a row', () => {
    vi.useFakeTimers();
    const onIntent = vi.fn();
    const intent = createSidebarHoverIntent(onIntent);

    intent.schedule();
    vi.advanceTimersByTime(SIDEBAR_HOVER_INTENT_DELAY_MS);

    expect(onIntent).toHaveBeenCalledOnce();
  });

  it('runs immediately on an actual interaction without a delayed duplicate', () => {
    vi.useFakeTimers();
    const onIntent = vi.fn();
    const intent = createSidebarHoverIntent(onIntent);

    intent.schedule();
    intent.runNow();
    vi.advanceTimersByTime(SIDEBAR_HOVER_INTENT_DELAY_MS);

    expect(onIntent).toHaveBeenCalledOnce();
  });
});
