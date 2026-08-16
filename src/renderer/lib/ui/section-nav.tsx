import { Fragment } from 'react';
import { Badge } from '@renderer/lib/ui/badge';
import { Separator } from '@renderer/lib/ui/separator';
import { cn } from '@renderer/utils/utils';

export type SectionNavItem<Id extends string> = {
  id: Id;
  label: string;
  badge?: string;
};

export type SectionNavGroup<Id extends string> = {
  id: string;
  items: SectionNavItem<Id>[];
};

/**
 * Vertical section rail shared by the settings and library shells so both read
 * identically: text-only entries, groups told apart by a rule. The host owns
 * the surrounding column (width, padding, border); this owns item states.
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
          {groupIndex > 0 && <Separator className="my-2" />}
          {group.items.map(({ id, label, badge }) => {
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
