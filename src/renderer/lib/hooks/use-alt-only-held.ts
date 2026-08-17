import { useEffect, useRef, useState } from 'react';

type ModifierState = {
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
};

/**
 * Alt/Option means "run the alternate action" only when it is the whole
 * gesture. Cmd+Alt, Ctrl+Alt and Shift+Alt belong to other bindings, so they
 * must not trigger the override or its preview.
 */
export function isAltOnlyModifier(event: ModifierState): boolean {
  return event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey;
}

const MODIFIER_KEYS = new Set(['Alt', 'Control', 'Meta', 'Shift']);

/**
 * Tracks whether Alt/Option is held on its own so an affordance can preview the
 * alternate action it would run. Window blur clears it: focus can leave while
 * the key is down (Alt opens native menus on some platforms) and the matching
 * keyup would never arrive, stranding the preview on.
 *
 * Option is also a common terminal modifier, so keep this in the smallest
 * component that renders the preview — every press re-renders its subscriber.
 */
export function useAltOnlyHeld(): boolean {
  const [held, setHeld] = useState(false);
  const heldRef = useRef(false);

  useEffect(() => {
    const apply = (next: boolean) => {
      if (heldRef.current === next) return;
      heldRef.current = next;
      setHeld(next);
    };
    // A non-modifier keydown means Alt is part of a chord (Option+letter in a
    // terminal), which is not the override gesture. Its keyup ends the chord,
    // so Alt on its own counts again from there.
    const onKeyDown = (event: KeyboardEvent) =>
      apply(MODIFIER_KEYS.has(event.key) && isAltOnlyModifier(event));
    const onKeyUp = (event: KeyboardEvent) => apply(isAltOnlyModifier(event));
    const clear = () => apply(false);

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', clear);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', clear);
    };
  }, []);

  return held;
}
