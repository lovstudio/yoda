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
}: {
  label: string;
  title?: string;
  icon?: React.ReactNode;
  isActive: boolean;
  closeLabel?: string;
  onSelect: () => void;
  onClose?: () => void;
}) {
  return (
    <div
      role="tab"
      aria-selected={isActive}
      tabIndex={0}
      title={title ?? label}
      className={cn(
        'group flex h-7 max-w-44 shrink-0 cursor-default select-none items-center gap-1.5 rounded-md border border-transparent py-1 px-2 text-xs [-webkit-app-region:no-drag]',
        onClose && 'pr-1',
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
      {icon ? (
        <span className="flex size-3.5 shrink-0 items-center justify-center">{icon}</span>
      ) : null}
      <span className="min-w-0 truncate">{label}</span>
      {onClose ? (
        <span className="flex size-4 shrink-0 items-center justify-center">
          <button
            type="button"
            aria-label={closeLabel}
            title={closeLabel}
            className="invisible flex size-4 items-center justify-center rounded-sm text-foreground-passive hover:bg-background-2 hover:text-foreground group-hover:visible"
            onClick={(event) => {
              event.stopPropagation();
              onClose();
            }}
          >
            <X className="size-3" />
          </button>
        </span>
      ) : null}
    </div>
  );
}
