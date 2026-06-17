import type { ReactNode } from 'react';
import { cn } from '@renderer/utils/utils';
import { AgentAvatar } from './agent-avatar';

interface AgentCardProps {
  /** Drives the monogram avatar and is the card's title. */
  name: string;
  description?: string;
  /** Tiny label above the name (e.g. a role). */
  eyebrow?: ReactNode;
  /** Inline content after the name (badges like leader / model). */
  badges?: ReactNode;
  /** Quiet metadata under the description — usually an AgentMetaRow. */
  footer?: ReactNode;
  /** Right-aligned controls (hover actions, editor inputs). */
  trailing?: ReactNode;
  className?: string;
}

/**
 * The canonical Agent identity card. One visual definition for every surface
 * that shows an Agent — manager grid, team roster, and (via its own interactive
 * variant) the composer slot. Wrap the whole thing in `group` so `trailing`
 * controls can reveal on hover.
 */
export function AgentCard({
  name,
  description,
  eyebrow,
  badges,
  footer,
  trailing,
  className,
}: AgentCardProps) {
  return (
    <div
      className={cn(
        'group flex min-w-0 items-start gap-2.5 rounded-xl border border-border/60 bg-background-1 p-2.5 transition-colors hover:border-border',
        className
      )}
    >
      <AgentAvatar name={name} className="size-9 text-sm" />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        {eyebrow}
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="min-w-0 truncate text-[13px] font-medium text-foreground">{name}</span>
          {badges}
        </div>
        {description && (
          <p className="line-clamp-2 text-xs leading-snug text-foreground-muted">{description}</p>
        )}
        {footer}
      </div>
      {trailing}
    </div>
  );
}
