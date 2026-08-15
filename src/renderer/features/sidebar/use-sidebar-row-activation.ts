import { useCallback, useMemo } from 'react';

/**
 * Matches the sidebar `PointerSensor` activation distance (see
 * `sidebar-dnd-context.tsx`). Below it the gesture is a click, at or above it
 * dnd-kit owns the pointer and this activation yields.
 */
const DRAG_ACTIVATION_DISTANCE_PX = 6;

/**
 * A `click` always follows its own `pointerup` within the same task. Anything
 * later is a separate activation (keyboard, synthetic, programmatic).
 */
const POINTER_CLICK_PAIRING_MS = 300;

export type SidebarRowActivation = { altKey: boolean };

type PendingActivation = {
  pointerId: number;
  x: number;
  y: number;
  activate: (event: SidebarRowActivation) => void;
};

/**
 * The gesture deliberately lives in module state rather than in the row's
 * component state.
 *
 * A sidebar row is free to move — or unmount entirely — between press and
 * release: opening a task changes its runtime status, which re-sorts it into
 * another priority group. The DOM then dispatches `click` on the nearest common
 * ancestor of the mousedown and mouseup targets, so the row's own `onClick`
 * never runs and the click is silently swallowed (relocated: `click` lands on
 * the list container; unmounted: no `click` at all). Completing the activation
 * from a window-level `pointerup` keeps the user's intent tied to the gesture
 * instead of to a DOM node that may no longer be there.
 */
let pending: PendingActivation | null = null;
/** Timestamp of the last pointer-completed activation, to dedupe its `click`. */
let lastActivatedAt = Number.NEGATIVE_INFINITY;

function endGesture(event: PointerEvent): void {
  const current = pending;
  if (!current || event.pointerId !== current.pointerId) return;
  pending = null;
  window.removeEventListener('pointerup', endGesture);
  window.removeEventListener('pointercancel', endGesture);
  if (event.type !== 'pointerup') return;
  const distance = Math.hypot(event.clientX - current.x, event.clientY - current.y);
  if (distance >= DRAG_ACTIVATION_DISTANCE_PX) return;
  lastActivatedAt = event.timeStamp;
  current.activate({ altKey: event.altKey });
}

function beginGesture(event: React.PointerEvent<HTMLElement>, next: PendingActivation): void {
  if (pending) {
    window.removeEventListener('pointerup', endGesture);
    window.removeEventListener('pointercancel', endGesture);
  }
  pending = next;
  window.addEventListener('pointerup', endGesture);
  window.addEventListener('pointercancel', endGesture);
  void event;
}

/**
 * Row activation that survives the row relocating or unmounting mid-press.
 *
 * Returns handlers for the row element. `onClick` remains wired so keyboard and
 * synthetic activation still work exactly once; it is ignored for the click
 * paired with a pointer gesture this hook already completed.
 */
export function useSidebarRowActivation(activate: (event: SidebarRowActivation) => void): {
  onPointerDown: (event: React.PointerEvent<HTMLElement>) => void;
  onClick: (event: React.MouseEvent<HTMLElement>) => void;
} {
  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      if (event.button !== 0) return;
      if (event.target instanceof Element && event.target.closest('button')) return;
      beginGesture(event, {
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        activate,
      });
    },
    [activate]
  );

  const onClick = useCallback(
    (event: React.MouseEvent<HTMLElement>) => {
      if (event.timeStamp - lastActivatedAt < POINTER_CLICK_PAIRING_MS) return;
      activate({ altKey: event.altKey });
    },
    [activate]
  );

  return useMemo(() => ({ onPointerDown, onClick }), [onClick, onPointerDown]);
}
