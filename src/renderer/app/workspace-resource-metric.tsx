import { ChevronRight } from 'lucide-react';
import { cn } from '@renderer/utils/utils';

type WorkspaceResourceMetricProps = {
  label: string;
  value: string;
  title?: string;
  ariaLabel?: string;
  controls?: string;
  expanded?: boolean;
  selected?: boolean;
  opensDialog?: boolean;
  onClick?: () => void;
};

export function WorkspaceResourceMetric({
  label,
  value,
  title,
  ariaLabel,
  controls,
  expanded,
  selected = false,
  opensDialog,
  onClick,
}: WorkspaceResourceMetricProps) {
  const content = (
    <>
      <div className="text-[10px] uppercase tracking-wide text-foreground-passive">{label}</div>
      <div className="mt-1 flex items-center justify-between gap-2 font-mono text-sm tabular-nums text-foreground">
        <span>{value}</span>
        {onClick ? (
          <ChevronRight
            aria-hidden
            className={cn(
              'size-3.5 text-foreground-passive transition-transform',
              !opensDialog && expanded && 'rotate-90'
            )}
          />
        ) : null}
      </div>
    </>
  );

  return onClick ? (
    <button
      type="button"
      aria-controls={controls}
      aria-expanded={opensDialog ? undefined : expanded}
      aria-haspopup={opensDialog ? 'dialog' : undefined}
      aria-label={ariaLabel}
      title={title}
      className={cn(
        'bg-background p-2.5 text-left outline-none transition-colors hover:bg-background-2 focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring',
        selected && 'bg-background-2'
      )}
      onClick={onClick}
    >
      {content}
    </button>
  ) : (
    <div className="bg-background p-2.5" title={title}>
      {content}
    </div>
  );
}
