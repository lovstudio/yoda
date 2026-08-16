import type { ComponentType } from 'react';

/**
 * Where an entry sits along the bar.
 *
 * - `lead` — pinned to the left edge, always present.
 * - `session` — inside the session group, which only exists while a session is
 *   active and owns the spacing between its entries.
 * - `tray` — right edge, after the flexible gap.
 */
export type RuntimeBarSlot = 'lead' | 'session' | 'tray';

/**
 * One bar entry. Entries own their state, their data sources and their own
 * visibility — an entry that has nothing to show renders `null` and disappears
 * from the row. The bar itself only knows which slot an entry belongs to.
 *
 * Adding an entry means adding a module under `items/` and one line in
 * `registry.ts`; nothing in the bar changes. A host that embeds this bar
 * elsewhere (see `agents/architecture/renderer.md`) supplies its own registry.
 */
export type RuntimeBarItem = {
  /** Stable id — React key, and the handle a host uses to drop an entry. */
  id: string;
  slot: RuntimeBarSlot;
  Component: ComponentType;
};
