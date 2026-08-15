import { ChevronDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@renderer/utils/utils';
import {
  SIDEBAR_TASK_GROUP_REVEAL_INCREMENT,
  type SidebarTaskGroupRowVariant,
} from './sidebar-task-group';

interface SidebarTaskGroupToggleProps {
  hiddenCount: number;
  loading?: boolean;
  rowVariant: SidebarTaskGroupRowVariant;
  onToggle: () => void;
}

export function SidebarTaskGroupToggle({
  hiddenCount,
  loading = false,
  rowVariant,
  onToggle,
}: SidebarTaskGroupToggleProps) {
  const { t } = useTranslation();
  const label = loading
    ? t('sidebar.loading')
    : t('sidebar.showMoreGroupItems', {
        count: Math.min(hiddenCount, SIDEBAR_TASK_GROUP_REVEAL_INCREMENT),
      });

  return (
    <button
      type="button"
      disabled={loading}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onToggle}
      className={cn(
        'flex h-7 w-full min-w-0 items-center gap-1 overflow-hidden rounded-lg pr-2 text-left text-xs font-medium text-foreground-tertiary-muted transition-colors hover:bg-background-tertiary-1 hover:text-foreground-tertiary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        // Match the indent of the task rows this row discloses, so the label
        // lines up with their titles rather than with the group's chevron.
        rowVariant === 'underProject' ? 'pl-8' : rowVariant === 'flat' ? 'pl-6' : 'pl-2'
      )}
    >
      <span className="truncate">{label}</span>
      <ChevronDown className={cn('size-3.5 shrink-0', loading && 'animate-pulse')} />
    </button>
  );
}
