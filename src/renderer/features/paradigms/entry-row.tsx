import { Check, Copy, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { AvatarValue } from '@renderer/lib/components/avatar-value';
import { Badge } from '@renderer/lib/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@renderer/lib/ui/dropdown-menu';
import { cn } from '@renderer/utils/utils';
import type { ParadigmEntry } from './entries';
import { ParadigmIcon } from './icons';

/**
 * One paradigm in the picker: a way of developing, with the actions that belong to
 * it.
 *
 * Every row is the same component whatever kind backs it — a single-Agent
 * paradigm and a five-Agent team are both one way of working, and the list is
 * flat for that reason. Per-row actions live behind a three-dot menu so the row
 * reads as a name until the user reaches for them.
 */
export function ParadigmEntryRow({
  entry,
  category,
  name,
  active,
  onSelect,
  onDuplicate,
  onEdit,
  onRemove,
}: {
  entry: ParadigmEntry;
  /** The kind's name. Leads the row: it says what this way of working is. */
  category: string;
  /** What this one is called, when it is called anything. */
  name: string | null;
  active: boolean;
  onSelect: () => void;
  onDuplicate: () => void;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();

  return (
    <div
      className={cn(
        'group/paradigm flex items-center gap-2 rounded-md px-2.5 py-2 text-sm transition-colors',
        active
          ? 'bg-primary/10 font-medium text-primary'
          : 'text-foreground-muted hover:bg-background-2 hover:text-foreground'
      )}
    >
      <button
        type="button"
        role="tab"
        aria-selected={active}
        title={t(entry.descKey)}
        onClick={onSelect}
        className="flex min-w-0 flex-1 items-center gap-2 text-left"
      >
        {entry.avatar !== undefined ? (
          <AvatarValue
            name={name ?? category}
            value={entry.avatar}
            className="size-4 rounded-sm text-[10px]"
          />
        ) : (
          <ParadigmIcon
            iconId={entry.iconId}
            className={cn('size-4 shrink-0', active ? 'text-primary' : 'text-foreground-muted')}
          />
        )}
        {/* Category first, then what this one is called: a row is read as "which
            way of working", and only then as "which one of those". */}
        <span className="flex min-w-0 flex-1 items-center gap-1.5">
          <span className="shrink-0">{category}</span>
          {name && <span className="min-w-0 truncate font-normal opacity-60">{name}</span>}
          {entry.alpha && (
            <Badge variant="secondary" className="shrink-0 px-1 py-0 text-[9px]">
              {t('home.modeAlphaBadge')}
            </Badge>
          )}
        </span>
        {active && <Check className="size-3.5 shrink-0 text-primary" />}
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={t('common.more')}
          title={t('common.more')}
          className={cn(
            'flex size-5 shrink-0 items-center justify-center rounded-sm text-foreground-passive transition-opacity hover:bg-background-1 hover:text-foreground focus-visible:opacity-100 group-hover/paradigm:opacity-100',
            // Kept visible on the selected row: duplicating is how a built-in
            // becomes editable, so the way in cannot be hover-only on the one row
            // the user is already looking at.
            active ? 'opacity-70' : 'opacity-0'
          )}
        >
          <MoreHorizontal className="size-3" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          {/* Duplicate comes first because it is the way into every other action
              for a built-in: those cannot be edited, only copied and then edited. */}
          <DropdownMenuItem onClick={onDuplicate}>
            <Copy className="size-3.5" />
            {t('home.paradigmDuplicate')}
          </DropdownMenuItem>
          {!entry.builtin && (
            <>
              <DropdownMenuItem onClick={onEdit}>
                <Pencil className="size-3.5" />
                {t('home.paradigmEdit')}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={onRemove}>
                <Trash2 className="size-3.5" />
                {t('home.paradigmRemove')}
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
