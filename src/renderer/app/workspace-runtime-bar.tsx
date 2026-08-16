import { observer } from 'mobx-react-lite';
import type { RuntimeBarItem, RuntimeBarSlot } from './runtime-bar/contract';
import { RUNTIME_BAR_ITEMS } from './runtime-bar/registry';
import { useRuntimeBarSession } from './runtime-bar/session-context';

function slotItems(slot: RuntimeBarSlot): RuntimeBarItem[] {
  return RUNTIME_BAR_ITEMS.filter((item) => item.slot === slot);
}

function RuntimeBarSlotItems({ slot }: { slot: RuntimeBarSlot }) {
  return slotItems(slot).map(({ id, Component }) => <Component key={id} />);
}

/**
 * The workspace footer: a row of independent entries, not a component that knows
 * what any of them do. Everything that used to live here now lives under
 * `runtime-bar/` — one module per entry, registered in `runtime-bar/registry.ts`.
 * The bar contributes exactly three things: the strip itself, the session group
 * (which exists only while a session is active), and the gap that pushes the
 * tray right.
 */
export const WorkspaceRuntimeBar = observer(function WorkspaceRuntimeBar() {
  const { runtimeId } = useRuntimeBarSession();

  return (
    <footer
      data-yoda-surface="workspace-runtime-bar"
      className="@container flex h-8 min-w-0 shrink-0 items-center gap-0.5 overflow-hidden whitespace-nowrap border-t border-border bg-background-secondary px-1.5 text-[11px] text-foreground-muted"
    >
      <RuntimeBarSlotItems slot="lead" />
      {runtimeId ? (
        <div className="flex min-w-0 items-center gap-0.5 overflow-hidden @min-[1121px]:gap-1.5">
          <RuntimeBarSlotItems slot="session" />
        </div>
      ) : null}
      <span className="flex-1" />
      <RuntimeBarSlotItems slot="tray" />
    </footer>
  );
});
