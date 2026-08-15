import { Copy, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
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
    // The row is the button. Anything outside it — padding included — is dead
    // space that looks clickable and is not, which is what made hits near the
    // edges miss.
    <div className="group/paradigm relative">
      <button
        type="button"
        role="tab"
        aria-selected={active}
        title={t(entry.descKey)}
        onClick={onSelect}
        className={cn(
          'flex w-full min-w-0 items-center gap-2 rounded-md py-1.5 pl-2 pr-8 text-left text-sm transition-colors',
          active
            ? 'bg-primary/10 font-medium text-primary'
            : 'text-foreground hover:bg-background-2'
        )}
      >
        {/* A fixed slot for either mark. A kind's glyph and an instance's avatar
            have different intrinsic widths, and letting each set its own left the
            labels starting at ragged offsets down the list. */}
        <span className="flex size-4 shrink-0 items-center justify-center">
          {entry.avatar !== undefined ? (
            <AvatarValue
              name={name ?? category}
              value={entry.avatar}
              className="size-4 rounded-sm text-[10px]"
            />
          ) : (
            <ParadigmIcon
              iconId={entry.iconId}
              className={cn('size-4', active ? 'text-primary' : 'text-foreground-muted')}
            />
          )}
        </span>
        {/* Category first, then what this one is called: a row is read as "which
            way of working", and only then as "which one of those". One truncating
            line, so the category — what the list is scanned by — is the part that
            survives a narrow row. */}
        <span className="min-w-0 flex-1 truncate">
          <span>{category}</span>
          {name && <span className="font-normal text-foreground-muted"> {name}</span>}
        </span>
        {entry.alpha && (
          <Badge
            variant="secondary"
            className="shrink-0 px-1 py-0 text-[9px] font-normal uppercase tracking-wide"
          >
            {t('home.modeAlphaBadge')}
          </Badge>
        )}
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={t('common.more')}
          title={t('common.more')}
          className={cn(
            'absolute right-1 top-1/2 flex size-6 -translate-y-1/2 items-center justify-center rounded-md text-foreground-passive transition-opacity hover:bg-background-2 hover:text-foreground focus-visible:opacity-100 group-hover/paradigm:opacity-100',
            // Kept visible on the selected row: it is the one the user is already
            // looking at, so its actions should not be hover-only.
            active ? 'opacity-60' : 'opacity-0'
          )}
        >
          <MoreHorizontal className="size-3.5" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          {/* Every row can be named and re-iconed, shipped ones included: the
              paradigm the user works in daily is the one they most want to call
              their own, and making that cost a duplicate leaves the list with two
              near-identical rows. */}
          <DropdownMenuItem onClick={onEdit}>
            <Pencil className="size-3.5" />
            {t('home.paradigmEdit')}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onDuplicate}>
            <Copy className="size-3.5" />
            {t('home.paradigmDuplicate')}
          </DropdownMenuItem>
          {/* A shipped paradigm stays: the app references it by id, and clearing
              its name and icon already restores what it shipped with. */}
          {!entry.builtin && (
            <>
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
