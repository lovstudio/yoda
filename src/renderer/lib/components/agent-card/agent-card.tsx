import { CopyPlus, Pencil, Trash2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/lib/ui/tooltip';
import { cn } from '@renderer/utils/utils';
import { AgentAvatar } from './agent-avatar';

interface AgentCardProps {
  /** Drives the fallback avatar and is the card's title. */
  name: string;
  /** Optional user-authored Agent glyph/image value. */
  icon?: string;
  description?: string;
  /** Tiny label above the name (e.g. a role). */
  eyebrow?: ReactNode;
  /** Inline content after the name (badges like leader / model). */
  badges?: ReactNode;
  /** Quiet metadata under the description — usually an AgentMetaRow. */
  footer?: ReactNode;
  /** Optional canonical edit action for Agent surfaces. */
  onEdit?: () => void;
  editLabel?: string;
  /** Optional canonical duplicate action for Agent surfaces. */
  onDuplicate?: () => void;
  /** Accessible label and tooltip for the duplicate action. */
  duplicateLabel?: string;
  /** Optional canonical delete action for Agent surfaces. */
  onDelete?: () => void;
  deleteLabel?: string;
  /** Additional right-aligned controls, after the canonical actions. */
  trailing?: ReactNode;
  className?: string;
}

/**
 * The canonical Agent identity card. One visual definition for every surface
 * that shows an Agent — manager grid, team roster, and (via its own interactive
 * variant) the composer slot. Canonical actions stay visible and aligned to the
 * card edge so their meaning and placement do not change on hover.
 */
export function AgentCard({
  name,
  icon,
  description,
  eyebrow,
  badges,
  footer,
  onEdit,
  editLabel = 'Edit',
  onDuplicate,
  duplicateLabel = 'Duplicate',
  onDelete,
  deleteLabel = 'Delete',
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
      <AgentAvatar name={name} icon={icon} className="size-9 text-sm" />
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
      {onEdit || onDuplicate || onDelete || trailing ? (
        <div
          className="ml-auto flex shrink-0 items-center gap-0.5 self-start"
          data-testid="agent-card-actions"
        >
          {onEdit ? (
            <AgentCardActionButton label={editLabel} onClick={onEdit}>
              <Pencil className="size-3.5" aria-hidden="true" />
            </AgentCardActionButton>
          ) : null}
          {onDuplicate ? (
            <AgentCardActionButton label={duplicateLabel} onClick={onDuplicate}>
              <CopyPlus className="size-3.5" aria-hidden="true" />
            </AgentCardActionButton>
          ) : null}
          {onDelete ? (
            <AgentCardActionButton label={deleteLabel} onClick={onDelete} destructive>
              <Trash2 className="size-3.5" aria-hidden="true" />
            </AgentCardActionButton>
          ) : null}
          {trailing}
        </div>
      ) : null}
    </div>
  );
}

function AgentCardActionButton({
  label,
  onClick,
  destructive = false,
  children,
}: {
  label: string;
  onClick: () => void;
  destructive?: boolean;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label={label}
            onClick={onClick}
            className={cn(
              'flex size-7 items-center justify-center rounded-md text-foreground-muted transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
              destructive
                ? 'hover:bg-destructive/10 hover:text-destructive'
                : 'hover:bg-background-2 hover:text-foreground'
            )}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
