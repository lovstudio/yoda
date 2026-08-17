import { useSyncExternalStore } from 'react';
import type { RuntimeBarItem, RuntimeBarSlot } from './contract';

/**
 * Reading order for one slot. A stable sort on `order` leaves entries that
 * declare none in the order the host listed them, so a host that owns its
 * whole bar never has to number anything.
 */
export function orderRuntimeBarItems(
  items: readonly RuntimeBarItem[],
  slot: RuntimeBarSlot
): readonly RuntimeBarItem[] {
  return items
    .filter((item) => item.slot === slot)
    .map((item, index) => ({ item, index }))
    .sort((a, b) => (a.item.order ?? 0) - (b.item.order ?? 0) || a.index - b.index)
    .map(({ item }) => item);
}

/**
 * A bar whose entries arrive at runtime, from registrants that do not know
 * about each other. A host that knows its entries at build time needs none of
 * this — it hands the strip a plain array.
 */
export type RuntimeBarRegistry = {
  /** Add an entry; the returned disposer removes it again. */
  register(item: RuntimeBarItem): () => void;
  snapshot(): readonly RuntimeBarItem[];
  subscribe(listener: () => void): () => void;
};

/**
 * One registry instance per host activation — never a module-level singleton,
 * so unloading a plugin cannot leave entries behind for the next one.
 */
export function createRuntimeBarRegistry(): RuntimeBarRegistry {
  let items: readonly RuntimeBarItem[] = [];
  const listeners = new Set<() => void>();
  const emit = (): void => {
    for (const listener of listeners) listener();
  };

  return {
    register(item) {
      // Re-registering an id replaces it rather than doubling it: a reloaded
      // contributor should not have to remember to unregister first.
      items = [...items.filter((existing) => existing.id !== item.id), item];
      emit();
      return () => {
        items = items.filter((existing) => existing !== item);
        emit();
      };
    },
    snapshot() {
      return items;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** Subscribe a component to a live registry. */
export function useRuntimeBarItems(registry: RuntimeBarRegistry): readonly RuntimeBarItem[] {
  return useSyncExternalStore(registry.subscribe, registry.snapshot, registry.snapshot);
}
