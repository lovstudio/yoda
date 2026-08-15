import type { ParadigmIconId, ParadigmKindId } from '@shared/paradigms/contract';
import { paradigmKind } from '@shared/paradigms/kinds';
import type { Paradigm } from '@shared/paradigms/paradigm';

/**
 * One row in the paradigm picker — a paradigm *instance*.
 *
 * The list is flat: every row is one way of developing, whatever kind implements
 * it. There are no sections, because a section would only ever describe the
 * implementation and the user is choosing a way of working.
 *
 * A kind may surface many rows — each Agent Team is its own `team` row — so
 * identity lives on the entry, not the kind. Entries are projected from the
 * `paradigms` table, which is what makes every row renameable and duplicable.
 */
export interface ParadigmEntry {
  /** Paradigm instance id — what the picker keys, selects, and mutates on. */
  id: string;
  kindId: ParadigmKindId;
  iconId: ParadigmIconId;
  /** Glyph, image URL, or data URL from the instance; wins over `iconId`. */
  avatar?: string;
  /**
   * The kind's name — the category this instance belongs to. Always present:
   * an instance is always some way of working, and naming the category is what
   * keeps a named team from reading as an unrelated one-off.
   */
  categoryKey: string;
  /** The instance's own name. Absent when it has none. */
  name?: string;
  descKey: string;
  alpha?: boolean;
  /** Shipped instances can be renamed and re-iconed, but not removed. */
  builtin: boolean;
  pickerOrder: number;
}

/** User instances sort after every built-in, in list order. */
const USER_ORDER_BASE = 100;

/**
 * The instance's own name, resolved — what editing it starts from.
 *
 * Deliberately not the displayed name: that falls back to the category, and
 * seeding an edit with it would turn a localized label into a stored one on the
 * first keystroke.
 */
export function paradigmEntryOwnName(entry: ParadigmEntry): string {
  return entry.name ?? '';
}

/**
 * How an entry reads: its category, qualified by its own name when it has one.
 *
 * "Category · name" rather than name alone, because a name on its own does not
 * say what it will do — a team called `Review` and a vibe-coding instance called
 * `Review` run nothing alike, so the category is the part that disambiguates.
 *
 * An instance that was never named reads as the bare category. It deliberately
 * does not borrow the name of the Agent inside it: who a paradigm runs with is
 * shown as its roster, and having that same name stand in as the title too made
 * title and subtitle repeat each other.
 *
 * A name that only restates the category is dropped — a doubled name says less
 * while costing the width the real qualifiers need.
 */
export function paradigmEntryLabel(
  entry: ParadigmEntry,
  t: (key: string) => string
): { category: string; name: string | null } {
  const category = t(entry.categoryKey);
  const own = paradigmEntryOwnName(entry);
  return { category, name: own && own !== category ? own : null };
}

/**
 * Every picker row, in display order.
 *
 * Kinds outside the picker are dropped here rather than excluded upstream: their
 * instances are real and launchable, they are just reached another way.
 */
export function paradigmEntries(paradigms: readonly Paradigm[]): ParadigmEntry[] {
  let userIndex = 0;
  return paradigms
    .flatMap((paradigm) => {
      const kind = paradigmKind(paradigm.kindId);
      if (!kind.inPicker) return [];
      const rank = paradigm.builtin ? kind.pickerOrder : USER_ORDER_BASE + userIndex++;
      return [
        {
          id: paradigm.id,
          kindId: paradigm.kindId,
          iconId: kind.iconId,
          ...(paradigm.icon ? { avatar: paradigm.icon } : {}),
          // The category is the kind, always — an instance never stops being one
          // way of working, whatever it is named.
          categoryKey: kind.labelKey,
          // Only an instance that was named carries a name. A kind's own built-in
          // has none, and reads as the bare category rather than repeating it.
          ...(paradigm.label ? { name: paradigm.label } : {}),
          descKey: kind.descriptionKey,
          ...(kind.alpha ? { alpha: true } : {}),
          builtin: paradigm.builtin,
          pickerOrder: rank,
        } satisfies ParadigmEntry,
      ];
    })
    .sort((a, b) => a.pickerOrder - b.pickerOrder);
}

/**
 * The entry representing the committed selection.
 *
 * `paradigmId` is the remembered instance for `kindId`; it loses to the kind when
 * they disagree, because the kind is what the rest of the composer is configured
 * for. Falls back to the kind's first entry so a deleted instance degrades to its
 * kind rather than blanking the picker.
 */
export function paradigmEntryId(
  entries: readonly ParadigmEntry[],
  kindId: ParadigmKindId,
  paradigmId: string | undefined
): string | undefined {
  return selectByKind(entries, kindId, paradigmId)?.id;
}

/**
 * The selected instance itself, resolved the same way the picker resolves its
 * highlighted row.
 *
 * The composer needs the instance, not the row: seats and params live on it. Both
 * callers go through one rule so the row the user sees highlighted is the instance
 * that actually runs.
 */
export function selectByKind<T extends { id: string; kindId: ParadigmKindId }>(
  candidates: readonly T[],
  kindId: ParadigmKindId,
  paradigmId: string | undefined
): T | undefined {
  return (
    candidates.find((candidate) => candidate.kindId === kindId && candidate.id === paradigmId) ??
    candidates.find((candidate) => candidate.kindId === kindId) ??
    candidates[0]
  );
}
