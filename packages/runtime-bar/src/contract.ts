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
 * `Component` takes no props: an entry reads whatever it needs from its host
 * (React context, a store, a closed-over plugin context), which is what lets
 * the same bar carry Electron entries in one host and browser entries in
 * another without the bar knowing the difference.
 */
export type RuntimeBarItem = {
  /** Stable id — React key, and the handle a host uses to drop an entry. */
  id: string;
  slot: RuntimeBarSlot;
  Component: ComponentType;
  /**
   * Placement within the slot, low to high. Only meaningful when entries come
   * from registrants that cannot see each other: a host that owns its whole
   * bar writes the reading order into its registry array and leaves this
   * unset, since "which entry sits left of which" has one right answer per
   * host and nothing to compute at runtime.
   */
  order?: number;
};

/**
 * The class names the bar paints itself with. The layout is shared; the look
 * is not — one host resolves these against Tailwind's container queries, the
 * next against a CSS module. Nothing in the bar hard-codes a style.
 */
export type RuntimeBarTheme = {
  /** The strip itself: height, background, border, horizontal padding. */
  strip: string;
  /** The session group wrapper — present only while a session is active. */
  sessionGroup: string;
  /** The flexible gap that pushes the tray to the right edge. */
  spacer: string;
};
