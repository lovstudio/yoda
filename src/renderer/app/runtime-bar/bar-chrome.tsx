import { cn } from '@renderer/utils/utils';

/**
 * The bar's one action geometry. Every entry trigger uses it so the row reads as
 * a single rhythm: a fixed icon slot until the bar is wide enough for labels.
 */
export const RUNTIME_BAR_ACTION_CLASS =
  'relative flex h-6 w-7 shrink-0 items-center justify-center gap-0 rounded-md p-0 transition-colors hover:bg-background-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border @min-[1441px]:w-auto @min-[1441px]:gap-1 @min-[1441px]:px-1.5';

export const RUNTIME_BAR_ACTION_LABEL_CLASS = 'hidden @min-[1441px]:inline';

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
