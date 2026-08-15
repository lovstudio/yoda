import {
  BUILTIN_FEATURE_TEAM_ID,
  BUILTIN_REVIEW_TEAM_ID,
  BUILTIN_STARTUP_TEAM_ID,
} from '@shared/agent-team';
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
  /** The instance's own name, as an i18n key. Absent when it has none. */
  nameKey?: string;
  /** The instance's own name, literal. Absent when it has none. */
  name?: string;
  descKey: string;
  alpha?: boolean;
  /** Shipped instances can be renamed and re-iconed, but not removed. */
  builtin: boolean;
  pickerOrder: number;
}

/**
 * Presentation overrides for the built-in Agent Teams: localized copy so the
 * picker reads naturally instead of echoing a template name, plus the rank each
 * one has always had. Instance-level presentation is exactly what the entry
 * carries, so a built-in reads as a first-class paradigm rather than a template.
 */
const BUILTIN_TEAM_PRESENTATION: Record<
  string,
  { nameKey: string; descKey: string; pickerOrder: number; alpha?: boolean }
> = {
  [BUILTIN_FEATURE_TEAM_ID]: {
    nameKey: 'home.modeTeamFeature',
    descKey: 'home.modeTeamFeatureDesc',
    // Converged enough to sit among the single-thread paradigms rather than after
    // them, which is where it has always been.
    pickerOrder: 10,
  },
  [BUILTIN_REVIEW_TEAM_ID]: {
    nameKey: 'home.modeTeamReview',
    descKey: 'home.modeTeamReviewDesc',
    pickerOrder: 50,
  },
  [BUILTIN_STARTUP_TEAM_ID]: {
    nameKey: 'home.modeTeamStartup',
    descKey: 'home.modeTeamStartupDesc',
    pickerOrder: 51,
    // Honors the original "startup is alpha" call; the review team is GA.
    alpha: true,
  },
};

/** User instances sort after every built-in, in list order. */
const USER_ORDER_BASE = 100;

/**
 * The instance's own name, resolved — what editing it starts from.
 *
 * Deliberately not the displayed name: that falls back to the category or to the
 * Agent in the seat, and seeding an edit with either would turn a borrowed label
 * into a stored one on the first keystroke.
 */
export function paradigmEntryOwnName(entry: ParadigmEntry, t: (key: string) => string): string {
  return entry.name ?? (entry.nameKey ? t(entry.nameKey) : '');
}

/**
 * How an entry reads: its category, qualified by its own name when it has one.
 *
 * "Category · name" rather than name alone, because a name on its own does not
 * say what it will do — `Spec` is a team and `Review` is both a team and a
 * single-thread loop, so the category is the part that disambiguates.
 *
 * `fallbackName` covers the instance that was never named: a kind's own built-in
 * has no label, but the Agent sitting in it does, and that Agent is what tells
 * two rows of the same category apart.
 *
 * A name that only restates the category is dropped. It is the common case for
 * the fallback — the Agent seeded into a kind's seat is usually named after that
 * kind — and `Spec Spec` says less than `Spec` while costing the width the real
 * qualifiers need.
 */
export function paradigmEntryLabel(
  entry: ParadigmEntry,
  t: (key: string) => string,
  fallbackName?: string | null
): { category: string; name: string | null } {
  const category = t(entry.categoryKey);
  const own = paradigmEntryOwnName(entry, t);
  const name = own || fallbackName || null;
  return { category, name: name && name !== category ? name : null };
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
      const presentation = BUILTIN_TEAM_PRESENTATION[paradigm.id];
      const rank = paradigm.builtin
        ? (presentation?.pickerOrder ?? kind.pickerOrder)
        : USER_ORDER_BASE + userIndex++;
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
          // A shipped team's localized copy holds only while it is pristine: once
          // the user names it themselves, that name is the one they expect to see.
          ...(presentation && !paradigm.customized
            ? { nameKey: presentation.nameKey }
            : paradigm.label
              ? { name: paradigm.label }
              : {}),
          descKey: presentation?.descKey ?? kind.descriptionKey,
          ...((presentation?.alpha ?? kind.alpha) ? { alpha: true } : {}),
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
