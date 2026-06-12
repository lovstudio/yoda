import { X } from 'lucide-react';
import { cn } from '@renderer/utils/utils';

/**
 * A chip in a side-pane strip (task sidebar, shell side pane) — same visual
 * language as the titlebar's AppTab.
 */
export function SidebarChip({
  label,
  title,
  icon,
  isActive,
  closeLabel,
  onSelect,
  onClose,
  drag,
  dropMarker,
}: {
  label: string;
  title?: string;
  icon?: React.ReactNode;
  isActive: boolean;
  closeLabel?: string;
  onSelect: () => void;
  onClose?: () => void;
  /** Drag-source props (see app/tab-drag.ts) — chips stay presentation-only. */
  drag?: Pick<React.HTMLAttributes<HTMLDivElement>, 'onMouseDown'>;
  /** Marks the chip for drop-index math in its strip's drop zone. */
  dropMarker?: string;
}) {
  return (
    <div
      role="tab"
      aria-selected={isActive}
      tabIndex={0}
      title={title ?? label}
      data-tab-drop-marker={dropMarker}
      {...drag}
      className={cn(
        'group flex h-7 max-w-44 shrink-0 cursor-default select-none items-center gap-1.5 rounded-md border border-transparent py-1 px-2 text-xs [-webkit-app-region:no-drag]',
        isActive
          ? 'border-border bg-background-1 text-foreground'
          : 'text-foreground-muted hover:bg-background-2 hover:text-foreground'
      )}
      onClick={onSelect}
      onAuxClick={(event) => {
        if (event.button === 1 && onClose) onClose();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') onSelect();
      }}
    >
      {/* One leading slot: the icon morphs into the close action on hover,
          so the chip never spends an extra slot on a trailing ×. */}
      {icon || onClose ? (
        <span className="relative flex size-4 shrink-0 items-center justify-center">
          <span
            className={cn('flex items-center justify-center', onClose && 'group-hover:invisible')}
          >
            {icon}
          </span>
          {onClose ? (
            <button
              type="button"
              aria-label={closeLabel}
              title={closeLabel}
              className="absolute inset-0 hidden items-center justify-center rounded-sm text-foreground-passive hover:bg-background-2 hover:text-foreground group-hover:flex"
              onClick={(event) => {
                event.stopPropagation();
                onClose();
              }}
            >
              <X className="size-3" />
            </button>
          ) : null}
        </span>
      ) : null}
      <span className="min-w-0 truncate">{label}</span>
    </div>
  );
}
