import { useSyncExternalStore } from 'react';

// Tracks whether the Alt/Option key is held. Backed by a single set of window
// listeners shared across every consumer: the sidebar renders dozens of rows,
// so a per-row listener (and per-row re-render on each key event) would be
// wasteful. Releasing on blur prevents a stuck "held" state when focus leaves
// the window mid-press.
let held = false;
const subscribers = new Set<() => void>();
let attached = false;

function emit() {
  for (const notify of subscribers) notify();
}

function setHeld(next: boolean) {
  if (held === next) return;
  held = next;
  emit();
}

function ensureAttached() {
  if (attached) return;
  attached = true;
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Alt') setHeld(true);
  });
  window.addEventListener('keyup', (e) => {
    if (e.key === 'Alt') setHeld(false);
  });
  window.addEventListener('blur', () => setHeld(false));
}

export function useAltKeyHeld(): boolean {
  ensureAttached();
  return useSyncExternalStore(
    (notify) => {
      subscribers.add(notify);
      return () => subscribers.delete(notify);
    },
    () => held
  );
}
