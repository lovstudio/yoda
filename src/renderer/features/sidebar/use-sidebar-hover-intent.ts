import { useEffect, useMemo } from 'react';

export const SIDEBAR_HOVER_INTENT_DELAY_MS = 160;

export interface SidebarHoverIntent {
  schedule: () => void;
  cancel: () => void;
  runNow: () => void;
}

export function createSidebarHoverIntent(
  onIntent: () => void,
  delayMs = SIDEBAR_HOVER_INTENT_DELAY_MS
): SidebarHoverIntent {
  let timer: ReturnType<typeof setTimeout> | null = null;

  const cancel = () => {
    if (timer === null) return;
    clearTimeout(timer);
    timer = null;
  };

  return {
    schedule: () => {
      cancel();
      timer = setTimeout(() => {
        timer = null;
        onIntent();
      }, delayMs);
    },
    cancel,
    runNow: () => {
      cancel();
      onIntent();
    },
  };
}

/**
 * Delays sidebar prefetch work until the pointer intentionally rests on a row.
 * Rows merely passing beneath a stationary pointer while scrolling are cancelled
 * on leave, keeping filesystem and RPC work out of the scroll path.
 */
export function useSidebarHoverIntent(onIntent: () => void): SidebarHoverIntent {
  const intent = useMemo(() => createSidebarHoverIntent(onIntent), [onIntent]);
  useEffect(() => () => intent.cancel(), [intent]);

  return intent;
}
