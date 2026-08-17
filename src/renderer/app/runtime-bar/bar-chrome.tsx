import { cn } from '@renderer/utils/utils';

/**
 * Vertical hit-area extension for a bar trigger.
 *
 * The row is 32px tall and a trigger's chip is 24px, so the strip above and below
 * the chip belongs to the row — a press there reads as aiming at the trigger and
 * does nothing at all. Measured on the account-usage entry before this existed:
 * of the 32px the bar offers, only the middle 20px answered a click, over a
 * 22px-wide target. A transparent pseudo-element takes those presses without
 * changing a painted pixel.
 *
 * It deliberately overshoots the row, because the strip and the session group
 * both clip their overflow: the clip is what clamps the extension to exactly the
 * row, so no trigger reaches over the content above it. A group that hugs its
 * children instead of filling the row would clip the extension away entirely —
 * that is why `sessionGroup` carries `h-full`.
 */
const RUNTIME_BAR_HIT_AREA_CLASS =
  "before:absolute before:inset-x-0 before:-inset-y-1.5 before:content-['']";

/**
 * The bar's one action geometry. Every entry trigger uses it so the row reads as
 * a single rhythm: a fixed icon slot until the bar is wide enough for labels.
 */
export const RUNTIME_BAR_ACTION_CLASS = `relative flex h-6 w-7 shrink-0 items-center justify-center gap-0 rounded-md p-0 transition-colors hover:bg-background-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border @min-[1441px]:w-auto @min-[1441px]:gap-1 @min-[1441px]:px-1.5 ${RUNTIME_BAR_HIT_AREA_CLASS}`;

export const RUNTIME_BAR_ACTION_LABEL_CLASS = 'hidden @min-[1441px]:inline';

/**
 * Geometry for the entries that carry a reading rather than a bare glyph — a
 * label, a meter, a model name. Same height, focus ring and hit area as the icon
 * slot above; it grows with its content instead of sitting in a fixed 28px box,
 * and falls back to that box when the content compacts down to the glyph.
 */
export const RUNTIME_BAR_METRIC_ACTION_CLASS = `relative flex h-6 min-w-7 items-center justify-center gap-1 rounded-md px-1.5 transition-colors hover:bg-background-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border ${RUNTIME_BAR_HIT_AREA_CLASS}`;

/** Reading labels go before the icon slots do — they cost the most width. */
export const RUNTIME_BAR_METRIC_LABEL_CLASS = '@max-[1120px]:hidden';

/**
 * The session group's separator. An entry that needs one renders it as its own
 * first child, so the dot disappears together with the entry behind it.
 */
export function RuntimeBarSeparator() {
  return (
    <span aria-hidden className="@max-[1120px]:hidden">
      ·
    </span>
  );
}

/**
 * Shared usage meter: a compact inline bar inside a trigger, or a full-width one
 * inside a popover card.
 */
export function ContextProgressBar({
  percent,
  tone,
  compact = false,
}: {
  percent: number;
  tone: string;
  compact?: boolean;
}) {
  return (
    <span
      aria-valuemax={100}
      aria-valuemin={0}
      aria-valuenow={percent}
      className={cn(
        'overflow-hidden rounded-full bg-foreground-muted/20',
        compact ? 'h-1 w-9 @max-[720px]:hidden' : 'h-1.5 w-full'
      )}
      role="progressbar"
    >
      <span
        className={cn('block h-full rounded-full transition-[width] duration-300', tone)}
        style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
      />
    </span>
  );
}

/**
 * Label/value row shared by the bar's popovers: label flush left, value flush
 * right in mono digits so a stack of rows reads as an aligned column — and so a
 * provider answering one figure looks like a short version of the same card,
 * not a two-column grid with a hole in it.
 */
export function RuntimeMetricRow({
  label,
  value,
  title,
}: {
  label: string;
  value: string;
  title?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="min-w-0 truncate text-foreground-passive">{label}</span>
      <span className="text-right font-mono tabular-nums text-foreground" title={title}>
        {value}
      </span>
    </div>
  );
}
