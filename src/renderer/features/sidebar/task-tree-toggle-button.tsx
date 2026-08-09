import { ChevronRight } from 'lucide-react';
import type { MouseEvent } from 'react';
import { cn } from '@renderer/utils/utils';
import { SidebarItemMiniButton } from './sidebar-primitives';

interface TaskTreeToggleButtonProps {
  collapsed: boolean;
  label: string;
  variant: 'root' | 'nested';
  onToggle: () => void;
}

export function TaskTreeToggleButton({
  collapsed,
  label,
  variant,
  onToggle,
}: TaskTreeToggleButtonProps) {
  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    // A rapid double click emits two click events followed by dblclick. Treat
    // that sequence as one disclosure gesture instead of toggling twice.
    if (event.detail > 1) return;
    onToggle();
  };

  return (
    <SidebarItemMiniButton
      type="button"
      aria-label={label}
      aria-expanded={!collapsed}
      className={cn(
        variant === 'root'
          ? 'shrink-0 opacity-0 transition-opacity duration-150 group-hover/row:opacity-100'
          : 'absolute inset-0 h-auto w-auto rounded-sm text-foreground-tertiary opacity-0 transition-opacity duration-150 hover:bg-background-tertiary-2 hover:text-foreground group-hover/row:opacity-100'
      )}
      onClick={handleClick}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      <ChevronRight
        className={cn(
          variant === 'root' ? 'h-4 w-4' : 'h-3.5 w-3.5',
          'transition-transform',
          !collapsed && 'rotate-90'
        )}
      />
    </SidebarItemMiniButton>
  );
}
