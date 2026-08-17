import type { ComponentPropsWithoutRef, ReactElement } from 'react';
import type { RuntimeBarItem, RuntimeBarSlot, RuntimeBarTheme } from './contract';
import { orderRuntimeBarItems } from './registry';

type RuntimeBarStripProps = {
  items: readonly RuntimeBarItem[];
  theme: RuntimeBarTheme;
  /**
   * Whether a session is active. The session group is not merely hidden while
   * nothing is running — it does not exist, so its entries cannot hold layout
   * or run queries for a session that is not there.
   */
  sessionActive: boolean;
} & Omit<ComponentPropsWithoutRef<'footer'>, 'className' | 'children'>;

function SlotItems({
  items,
  slot,
}: {
  items: readonly RuntimeBarItem[];
  slot: RuntimeBarSlot;
}): ReactElement {
  return (
    <>
      {orderRuntimeBarItems(items, slot).map(({ id, Component }) => (
        <Component key={id} />
      ))}
    </>
  );
}

/**
 * The bar: a row of independent entries, and nothing that knows what any of
 * them do. It contributes exactly three things — the strip, the session group,
 * and the gap that pushes the tray to the right edge.
 *
 * Both hosts render this same component, so an entry cannot end up in a
 * different place depending on where it is mounted.
 */
export function RuntimeBarStrip({
  items,
  theme,
  sessionActive,
  ...footerProps
}: RuntimeBarStripProps): ReactElement {
  return (
    <footer className={theme.strip} {...footerProps}>
      <SlotItems items={items} slot="lead" />
      {sessionActive ? (
        <div className={theme.sessionGroup}>
          <SlotItems items={items} slot="session" />
        </div>
      ) : null}
      <span className={theme.spacer} />
      <SlotItems items={items} slot="tray" />
    </footer>
  );
}
