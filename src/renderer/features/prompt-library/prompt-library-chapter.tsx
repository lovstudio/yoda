import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@renderer/utils/utils';

export function PromptLibraryChapter({
  dataSlot,
  title,
  description,
  icon: Icon,
  actions,
  children,
  className,
  bodyClassName,
}: {
  dataSlot: string;
  title: string;
  description: string;
  icon: LucideIcon;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section
      data-slot={dataSlot}
      className={cn(
        'min-w-0 shrink-0 overflow-hidden rounded-lg border border-border bg-background-secondary',
        className
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <Icon className="mt-0.5 size-4 shrink-0 text-foreground-muted" />
          <div className="min-w-0">
            <h2 className="text-sm font-medium text-foreground">{title}</h2>
            <p className="mt-0.5 text-xs leading-5 text-foreground-muted">{description}</p>
          </div>
        </div>
        {actions ? <div className="w-full @3xl:w-auto">{actions}</div> : null}
      </div>
      {children ? (
        <div className={cn('border-t border-border bg-background p-3', bodyClassName)}>
          {children}
        </div>
      ) : null}
    </section>
  );
}
