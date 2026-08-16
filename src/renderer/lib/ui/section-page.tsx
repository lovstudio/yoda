import type { ReactNode } from 'react';
import { useIsPinHosted } from '@renderer/lib/layout/navigation-provider';
import { SectionNav, SectionNavDropdown, type SectionNavGroup } from '@renderer/lib/ui/section-nav';
import { Separator } from '@renderer/lib/ui/separator';
import { cn } from '@renderer/utils/utils';

/**
 * Two-column shell shared by every section-based page (settings, library): nav
 * rail on the left, one section's content on the right under a common header.
 * Owning the column widths and spacing here is what keeps those pages reading
 * as one design instead of drifting apart.
 *
 * The host owns the `@container` context the responsive classes below read.
 */
export function SectionPage<Id extends string>({
  groups,
  activeId,
  onSelect,
  navLabel,
  title,
  titleHint,
  description,
  fill = false,
  children,
}: {
  groups: SectionNavGroup<Id>[];
  activeId: Id;
  onSelect: (id: Id) => void;
  /** Names the rail for assistive tech and for the collapsed picker. */
  navLabel: string;
  title: string;
  titleHint?: ReactNode;
  description?: ReactNode;
  /** For content that owns its own height and scrolling (a running app, a board). */
  fill?: boolean;
  children: ReactNode;
}) {
  // In the side pane the chip-strip row hosts the picker — don't double it.
  const isPinHosted = useIsPinHosted();
  return (
    <div className="flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden">
      <div className="mx-auto flex h-full min-h-0 w-full max-w-[1060px] flex-col gap-6 px-8 @max-lg:px-6 @max-md:px-4">
        {/* Narrow containers (shell side pane, slim windows) hide the nav
            column; switching sections moves into the content header's
            dropdown. The collapse happens at @max-lg so the two-column layout
            never shows while too cramped to be usable. */}
        <div className="grid min-h-0 flex-1 grid-cols-[auto_minmax(0,1fr)] grid-rows-[minmax(0,1fr)] gap-6 overflow-hidden @max-lg:grid-cols-1 @max-lg:gap-4">
          <div className="flex min-h-0 flex-col py-10 @max-lg:hidden">
            <SectionNav
              groups={groups}
              activeId={activeId}
              onSelect={onSelect}
              className="w-max min-w-28 pr-2 [scrollbar-gutter:stable]"
            />
          </div>
          <div
            className={cn(
              'flex min-h-0 min-w-0 flex-1 flex-col',
              fill
                ? 'overflow-hidden'
                : 'overflow-x-hidden overflow-y-auto [scrollbar-gutter:stable]'
            )}
          >
            <div
              className={cn(
                'mx-auto flex w-full max-w-4xl flex-col py-10 pr-4 pl-1 @max-md:py-4 @max-md:pr-0 @max-md:pl-0',
                fill && 'min-h-0 flex-1'
              )}
            >
              <div className="flex flex-col gap-6">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex min-w-0 flex-col gap-1">
                    <div className="flex items-center gap-2">
                      <h2 className="text-xl">{title}</h2>
                      {titleHint}
                    </div>
                    {description && <p className="text-sm text-foreground-muted">{description}</p>}
                  </div>
                  {/* Narrow main-area fallback — in the side pane the
                      chip-strip row hosts the picker instead. */}
                  {!isPinHosted && (
                    <SectionNavDropdown
                      groups={groups}
                      activeId={activeId}
                      onSelect={onSelect}
                      label={navLabel}
                      className="hidden @max-lg:flex"
                    />
                  )}
                </div>
                <Separator />
              </div>
              <div className={cn('mt-8 space-y-8', fill && 'flex min-h-0 flex-1 flex-col')}>
                {children}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
