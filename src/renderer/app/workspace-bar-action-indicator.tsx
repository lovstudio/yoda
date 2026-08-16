import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@renderer/utils/utils';

/**
 * A compact runtime-bar action is one 14px glyph centred in a fixed 32px slot,
 * so the row should read as an even rhythm. What the eye measures is the gap
 * between ink, not between slots: an overlay pinned to the slot's right edge
 * spills into the 2px gutter, so its neighbour looks crowded while the
 * glyph-only actions look loosely spaced.
 *
 * Counters and status dots therefore anchor to the glyph box, not to the slot.
 * Use these primitives for any indicator on a bar action instead of
 * hand-positioning one, or the row drifts back out of rhythm.
 */
export function WorkspaceBarActionGlyph({
  icon: Icon,
  className,
  children,
}: {
  icon: LucideIcon;
  className?: string;
  /** Indicator overlay, positioned against the glyph box. */
  children?: ReactNode;
}) {
  return (
    <span className={cn('relative flex size-3.5 shrink-0 items-center justify-center', className)}>
      <Icon aria-hidden className="size-3.5" />
      {children}
    </span>
  );
}

/** Counter overlaying the glyph while the action is icon-only. */
export const WORKSPACE_BAR_ACTION_COUNT_CLASS =
  'absolute -top-1.5 -right-0.5 inline-flex h-3 min-w-3 items-center justify-center rounded-full bg-background-secondary px-0.5 font-mono text-[8px] leading-none tabular-nums ring-1 ring-border/60 @min-[1441px]:hidden';

/** Counter sitting after the action label once labels are back. */
export const WORKSPACE_BAR_ACTION_INLINE_COUNT_CLASS =
  'hidden h-4 min-w-4 items-center justify-center rounded-full bg-background-2 px-1 font-mono text-[9px] leading-none tabular-nums @min-[1441px]:inline-flex';

/** Status dot overlaying the glyph while the action is icon-only. */
export const WORKSPACE_BAR_ACTION_DOT_CLASS =
  'absolute -top-1 -right-0.5 size-1.5 rounded-full @min-[1441px]:hidden';

/** Status dot sitting after the action label once labels are back. */
export const WORKSPACE_BAR_ACTION_INLINE_DOT_CLASS =
  'hidden size-1.5 shrink-0 rounded-full @min-[1441px]:inline-block';
