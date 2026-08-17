import type { RuntimeBarTheme } from '@runtime-bar/contract';
import { RuntimeBarStrip } from '@runtime-bar/strip';
import { observer } from 'mobx-react-lite';
import { RUNTIME_BAR_ITEMS } from './runtime-bar/registry';
import { useRuntimeBarSession } from './runtime-bar/session-context';

/**
 * Yoda's look for the shared strip: Tailwind container queries, resolved
 * against the bar's own width rather than the viewport, so the entries compact
 * when the sidebar takes room and not when the display is small.
 */
const YODA_RUNTIME_BAR_THEME: RuntimeBarTheme = {
  strip:
    '@container flex h-8 min-w-0 shrink-0 items-center gap-0.5 overflow-hidden whitespace-nowrap border-t border-border bg-background-secondary px-1.5 text-[11px] text-foreground-muted',
  // `h-full` is load-bearing: the group clips its overflow to compact
  // horizontally, and a group that hugged its 24px children would clip each
  // trigger's hit-area extension away with it.
  sessionGroup: 'flex h-full min-w-0 items-center gap-0.5 overflow-hidden @min-[1121px]:gap-1.5',
  spacer: 'flex-1',
};

/**
 * The workspace footer. Everything it used to know now lives under
 * `runtime-bar/` — one module per entry, registered in `runtime-bar/registry.ts`
 * — and the row itself comes from `@yoda/runtime-bar`, the host-agnostic
 * framework the DSH plugin renders through as well. This file contributes only
 * Yoda's entries and Yoda's styling.
 */
export const WorkspaceRuntimeBar = observer(function WorkspaceRuntimeBar() {
  const { runtimeId } = useRuntimeBarSession();

  return (
    <RuntimeBarStrip
      data-yoda-surface="workspace-runtime-bar"
      items={RUNTIME_BAR_ITEMS}
      theme={YODA_RUNTIME_BAR_THEME}
      sessionActive={runtimeId !== null}
    />
  );
});
