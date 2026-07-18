import type { ComponentProps, ReactNode } from 'react';
import { Button } from '@renderer/lib/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/lib/ui/tooltip';
import { cn } from '@renderer/utils/utils';

type HeaderActionToolbarProps = {
  label: string;
  children: ReactNode;
  className?: string;
};

type HeaderActionButtonProps = Omit<
  ComponentProps<typeof Button>,
  'aria-label' | 'children' | 'size'
> & {
  label: string;
  children: ReactNode;
};

/** Groups peer header actions under one accessible, visually consistent toolbar. */
export function HeaderActionToolbar({ label, children, className }: HeaderActionToolbarProps) {
  return (
    <div
      role="toolbar"
      aria-label={label}
      className={cn('flex shrink-0 items-center gap-0.5', className)}
    >
      {children}
    </div>
  );
}

/**
 * A compact header action. The required label drives both its tooltip and
 * accessible name; size is intentionally fixed so peer actions cannot drift.
 */
export function HeaderActionButton({
  label,
  children,
  variant = 'ghost',
  ...props
}: HeaderActionButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={<Button size="icon-sm" variant={variant} aria-label={label} {...props} />}
      >
        {children}
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={8}>
        {label}
      </TooltipContent>
    </Tooltip>
  );
}
