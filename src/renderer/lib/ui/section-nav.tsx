import type { LucideIcon } from 'lucide-react';
import { Fragment } from 'react';
import { Badge } from '@renderer/lib/ui/badge';
import { Separator } from '@renderer/lib/ui/separator';
import { cn } from '@renderer/utils/utils';

export type SectionNavItem<Id extends string> = {
  id: Id;
  label: string;
  icon?: LucideIcon;
  badge?: string;
};

/** A labelled group renders a heading; an unlabelled one is split by a rule. */
export type SectionNavGroup<Id extends string> = {
  id: string;
  label?: string;
  items: SectionNavItem<Id>[];
};

/**
 * Vertical section rail shared by the settings and library shells so both read
 * identically. The host owns the surrounding column (padding, border, width);
 * this owns grouping and item states.
 */
export function SectionNav<Id extends string>({
  groups,
  activeId,
  onSelect,
  className,
}: {
  groups: SectionNavGroup<Id>[];
  activeId: Id;
  onSelect: (id: Id) => void;
  className?: string;
}) {
  return (
    <nav className={cn('flex min-h-0 flex-col gap-0.5 overflow-y-auto', className)}>
      {groups.map((group, groupIndex) => (
        <Fragment key={group.id}>
          {group.label ? (
            <div
              className={cn(
                'px-3 pb-1 text-[10px] font-medium uppercase tracking-wider text-foreground-passive',
                groupIndex === 0 ? 'pt-1' : 'pt-3'
              )}
            >
              {group.label}
            </div>
          ) : (
            groupIndex > 0 && <Separator className="my-2" />
          )}
          {group.items.map(({ id, label, icon: Icon, badge }) => {
            const isActive = id === activeId;
            return (
              <button
                key={id}
                type="button"
                onClick={() => onSelect(id)}
                aria-current={isActive}
                className={cn(
                  'flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm font-normal text-foreground-muted transition-colors hover:bg-background-1 hover:text-foreground',
                  isActive &&
                    'bg-background-2 text-foreground hover:bg-background-2 hover:text-foreground'
                )}
              >
                {Icon && <Icon className="size-4 shrink-0" />}
                <span className="truncate text-left">{label}</span>
                {badge && (
                  <Badge variant="secondary" className="text-[10px]">
                    {badge}
                  </Badge>
                )}
              </button>
            );
          })}
        </Fragment>
      ))}
    </nav>
  );
}
