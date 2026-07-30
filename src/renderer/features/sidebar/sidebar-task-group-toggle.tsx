import { ChevronDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@renderer/utils/utils';
import { type SidebarTaskGroupRowVariant } from './sidebar-task-group';

interface SidebarTaskGroupToggleProps {
  expanded: boolean;
  hiddenCount: number;
  rowVariant: SidebarTaskGroupRowVariant;
  onToggle: () => void;
}

export function SidebarTaskGroupToggle({
  expanded,
  hiddenCount,
  rowVariant,
  onToggle,
}: SidebarTaskGroupToggleProps) {
  const { t } = useTranslation();
  const label = expanded
    ? t('sidebar.collapseGroupItems')
    : t('sidebar.showMoreGroupItems', { count: hiddenCount });

  return (
    <button
      type="button"
      aria-expanded={expanded}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onToggle}
      className={cn(
        'flex h-7 w-full min-w-0 items-center gap-1.5 overflow-hidden rounded-lg text-left text-xs font-medium text-foreground-tertiary-muted transition-colors hover:bg-background-tertiary-1 hover:text-foreground-tertiary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        rowVariant === 'underProject' ? 'pl-8 pr-2' : 'px-2'
      )}
    >
      <ChevronDown
        className={cn('size-3.5 shrink-0 transition-transform', expanded && 'rotate-180')}
      />
      <span className="truncate">{label}</span>
    </button>
  );
}
