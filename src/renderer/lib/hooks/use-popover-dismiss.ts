import type { PopoverRoot } from '@base-ui/react/popover';
import { useCallback, useRef, type RefObject } from 'react';
import { flushSync } from 'react-dom';
import { useDismissOnWindowBlur } from '@renderer/lib/hooks/use-dismiss-on-window-blur';

type PopoverDismiss = {
  /** Wire into `<Popover actionsRef={...}>` so `dismiss` can unmount the popup. */
  actionsRef: RefObject<PopoverRoot.Actions | null>;
  /** Closes the popover and drops its popup in the same commit. */
  dismiss: () => void;
  /** Dismisses, then runs an action that navigates or focuses synchronously. */
  dismissThen: (action: () => void) => void;
};

/**
 * Programmatic dismissal for a controlled popover, plus auto-close on window
 * blur.
 *
 * Base UI keeps a closed popup mounted until its exit animation reports
 * completion, and drops the unmount entirely when that animation is aborted
 * instead of finished (`useAnimationsFinished`'s catch path, with
 * `treatAbortedAsFinished: false`). A synchronous route change blocks the main
 * thread long enough for exactly that, which strands a popup that nothing can
 * close afterwards: the popover's own state already reads closed, so Escape and
 * outside presses are no-ops. Unmounting through `actionsRef` keeps dismissal
 * independent of animation bookkeeping. Escape and outside presses still run
 * Base UI's own animated close.
 */
export function usePopoverDismiss(open: boolean, setOpen: (open: boolean) => void): PopoverDismiss {
  const actionsRef = useRef<PopoverRoot.Actions | null>(null);
  const dismiss = useCallback(() => {
    // The close has to be committed before the unmount: Base UI re-mounts the
    // popup when it observes the open-to-closed transition, so unmounting an
    // still-open popup only strands it one render later.
    flushSync(() => setOpen(false));
    actionsRef.current?.unmount();
  }, [setOpen]);
  const dismissThen = useCallback(
    (action: () => void) => {
      dismiss();
      action();
    },
    [dismiss]
  );

  useDismissOnWindowBlur(open, dismiss);

  return { actionsRef, dismiss, dismissThen };
}
