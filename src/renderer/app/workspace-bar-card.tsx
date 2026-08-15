import { Ellipsis, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@renderer/lib/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@renderer/lib/ui/dropdown-menu';
import { cn } from '@renderer/utils/utils';

/**
 * Every card that opens from the workspace runtime bar reads top-to-bottom the
 * same way: an icon next to the card's name, one or two sentences saying what
 * the card is for, then the content itself. Secondary jumps (docs, external
 * sites, destructive resets) belong in the header's overflow menu, not inline
 * next to the title.
 *
 * These primitives own that template. A card that hand-rolls its own header,
 * divider rhythm, or footer drifts out of the set, so extend these instead.
 */

/** Popover surface shared by the bar's cards. Sections supply their own padding. */
export const WORKSPACE_BAR_CARD_CLASS =
  'gap-0 border border-border bg-background p-0 text-foreground ring-0 shadow-lg';

export function WorkspaceBarCardHeader({
  icon: Icon,
  iconSlot,
  title,
  titleBadge,
  description,
  actions,
}: {
  /** Card identity icon, mirroring the runtime-bar trigger the card opens from. */
  icon?: LucideIcon;
  /** Use for non-lucide marks (an agent logo, for example). Wins over `icon`. */
  iconSlot?: ReactNode;
  title: ReactNode;
  titleBadge?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div
      data-slot="workspace-bar-card-header"
      className="flex shrink-0 items-start gap-2.5 border-b border-border px-3 py-2.5"
    >
      <span className="mt-px flex size-7 shrink-0 items-center justify-center rounded-md border border-border/60 bg-background-2 text-foreground-muted">
        {iconSlot ?? (Icon ? <Icon aria-hidden className="size-4" /> : null)}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1.5">
          <div className="min-w-0 truncate text-sm font-medium leading-5 text-foreground">
            {title}
          </div>
          {titleBadge}
        </div>
        {description ? (
          <p className="mt-0.5 text-xs leading-4 text-foreground-passive">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="-mr-1 flex shrink-0 items-center gap-0.5">{actions}</div> : null}
    </div>
  );
}

/**
 * A content block. Sections stack under the header, each drawing its own bottom
 * rule except the last, so the card never ends on a dangling divider.
 */
export function WorkspaceBarCardSection({
  label,
  labelAction,
  className,
  children,
}: {
  label?: ReactNode;
  labelAction?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      data-slot="workspace-bar-card-section"
      className={cn('border-b border-border px-3 py-2.5 last:border-b-0', className)}
    >
      {label ? (
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <span className="min-w-0 truncate text-[10px] font-medium tracking-wide text-foreground-passive uppercase">
            {label}
          </span>
          {labelAction}
        </div>
      ) : null}
      {children}
    </div>
  );
}

/** Label (plus optional hint) on the left, its control flush right. */
export function WorkspaceBarCardRow({
  label,
  description,
  control,
  className,
}: {
  label: ReactNode;
  description?: ReactNode;
  control: ReactNode;
  className?: string;
}) {
  return (
    <div
      data-slot="workspace-bar-card-row"
      className={cn('flex items-center justify-between gap-3', className)}
    >
      <div className="min-w-0">
        <div className="text-xs text-foreground">{label}</div>
        {description ? (
          <div className="mt-0.5 text-[11px] leading-4 text-foreground-passive">{description}</div>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-1.5">{control}</div>
    </div>
  );
}

/** Primary actions, pinned to the bottom edge of the card. */
export function WorkspaceBarCardFooter({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      data-slot="workspace-bar-card-footer"
      className={cn('shrink-0 border-t border-border px-3 py-2.5', className)}
    >
      {children}
    </div>
  );
}

/** Overflow menu for a header's secondary jumps and rarely used commands. */
export function WorkspaceBarCardMenu({
  label,
  className,
  children,
}: {
  /** Defaults to the shared "more" label. */
  label?: string;
  className?: string;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const menuLabel = label ?? t('common.more');
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            title={menuLabel}
            aria-label={menuLabel}
          />
        }
      >
        <Ellipsis aria-hidden className="size-3.5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        side="bottom"
        sideOffset={6}
        className={cn('w-52', className)}
      >
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
