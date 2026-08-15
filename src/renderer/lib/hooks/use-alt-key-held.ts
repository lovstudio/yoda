import { useEffect, useRef, useState } from 'react';

/**
 * Tracks whether Alt/Option is currently held so an affordance can preview the
 * alternate action it would run. Window blur clears it: focus can leave while
 * the key is down (Alt opens native menus on some platforms) and the matching
 * keyup would never arrive, stranding the preview on.
 *
 * Option is also a common terminal modifier, so keep this in the smallest
 * component that renders the preview — every press re-renders its subscriber.
 */
export function useAltKeyHeld(): boolean {
  const [held, setHeld] = useState(false);
  const heldRef = useRef(false);

  useEffect(() => {
    const apply = (next: boolean) => {
      if (heldRef.current === next) return;
      heldRef.current = next;
      setHeld(next);
    };
    const sync = (event: KeyboardEvent) => apply(event.altKey);
    const clear = () => apply(false);

    window.addEventListener('keydown', sync);
    window.addEventListener('keyup', sync);
    window.addEventListener('blur', clear);
    return () => {
      window.removeEventListener('keydown', sync);
      window.removeEventListener('keyup', sync);
      window.removeEventListener('blur', clear);
    };
  }, []);

  return held;
}
