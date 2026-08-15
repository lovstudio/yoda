import { useTranslation } from 'react-i18next';
import { Badge } from '@renderer/lib/ui/badge';
import { cn } from '@renderer/utils/utils';
import type { ParadigmEntry } from './entries';
import { ParadigmMark } from './icons';

/**
 * One paradigm in the picker: a way of developing.
 *
 * Every card is the same component whatever kind backs it — a single-Agent
 * paradigm and a five-Agent team are both one way of working, and the list is
 * flat for that reason. The card only selects: renaming, duplicating, and
 * removing belong to the pane that shows what is selected, so the list stays a
 * list of names.
 */
export function ParadigmEntryCard({
  entry,
  category,
  name,
  active,
  onSelect,
}: {
  entry: ParadigmEntry;
  /** The kind's name — which way of working this is. */
  category: string;
  /** What this one is called, when it is called anything. */
  name: string | null;
  active: boolean;
  onSelect: () => void;
}) {
  const { t } = useTranslation();

  // Name over category, on two lines rather than one. Half the list is teams, so
  // on a single line the shared category ate the width and truncated away the one
  // part that told the cards apart. Stacked, the repeated word is the quiet one
  // and the name is read first — and neither has to cut the other short.
  const title = name ?? category;
  // Under it: which way of working this is, or — for an instance that was never
  // named, and is therefore titled by its category already — what it does. Always
  // one line, so every card is the same height and the list scans as a column.
  const subtitle = name ? category : t(entry.descKey);

  return (
    // The card is the button. Anything outside it — padding included — is dead
    // space that looks clickable and is not, which is what made hits near the
    // edges miss.
    <button
      type="button"
      role="tab"
      aria-selected={active}
      title={t(entry.descKey)}
      onClick={onSelect}
      className={cn(
        'flex w-full min-w-0 items-center gap-2.5 rounded-xl border p-2 text-left transition-colors',
        // The chosen card carries the same mark an active card carries elsewhere
        // in the app — full-strength border plus a ring. A tint alone was what it
        // had, and at the alpha a tint can safely use it was invisible: nine
        // cards looked equally unselected.
        active
          ? 'border-primary bg-primary/8 ring-1 ring-primary/40'
          : 'border-border/60 bg-background-1 hover:border-border hover:bg-background-2/50'
      )}
    >
      <ParadigmMark iconId={entry.iconId} avatar={entry.avatar} name={title} active={active} />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex min-w-0 items-center gap-1.5">
          <span
            className={cn(
              'min-w-0 truncate text-[13px] font-medium',
              active ? 'text-primary' : 'text-foreground'
            )}
          >
            {title}
          </span>
          {entry.alpha && (
            <Badge
              variant="secondary"
              className="shrink-0 px-1 py-0 text-[9px] font-normal uppercase tracking-wide"
            >
              {t('home.modeAlphaBadge')}
            </Badge>
          )}
        </span>
        <span className="min-w-0 truncate text-[11px] leading-tight text-foreground-muted">
          {subtitle}
        </span>
      </span>
    </button>
  );
}
