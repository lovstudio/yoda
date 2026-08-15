import {
  BUILTIN_FEATURE_TEAM_ID,
  BUILTIN_REVIEW_TEAM_ID,
  BUILTIN_STARTUP_TEAM_ID,
  type AgentTeam,
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
  /** i18n key, for entries whose label is localized copy. */
  labelKey?: string;
  /** Literal label, for user-named instances. */
  label?: string;
  descKey: string;
  alpha?: boolean;
  /** Code-defined instances can be duplicated but not renamed or removed. */
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
  { labelKey: string; descKey: string; pickerOrder: number; alpha?: boolean }
> = {
  [BUILTIN_FEATURE_TEAM_ID]: {
    labelKey: 'home.modeTeamFeature',
    descKey: 'home.modeTeamFeatureDesc',
    // Converged enough to sit among the single-thread paradigms rather than after
    // them, which is where it has always been.
    pickerOrder: 10,
  },
  [BUILTIN_REVIEW_TEAM_ID]: {
    labelKey: 'home.modeTeamReview',
    descKey: 'home.modeTeamReviewDesc',
    pickerOrder: 50,
  },
  [BUILTIN_STARTUP_TEAM_ID]: {
    labelKey: 'home.modeTeamStartup',
    descKey: 'home.modeTeamStartupDesc',
    pickerOrder: 51,
    // Honors the original "startup is alpha" call; the review team is GA.
    alpha: true,
  },
};

/** User instances sort after every built-in, in list order. */
const USER_ORDER_BASE = 100;

/** Display name for a team across the composer: localized for built-ins. */
export function teamDisplayName(team: AgentTeam, t: (key: string) => string): string {
  const presentation = BUILTIN_TEAM_PRESENTATION[team.id];
  return presentation ? t(presentation.labelKey) : team.name;
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
          // An instance with no label of its own reads as its kind, which is what
          // makes a code-defined instance need no copy.
          ...(presentation
            ? { labelKey: presentation.labelKey }
            : paradigm.label
              ? { label: paradigm.label }
              : { labelKey: kind.labelKey }),
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
  const match =
    entries.find((entry) => entry.kindId === kindId && entry.id === paradigmId) ??
    entries.find((entry) => entry.kindId === kindId);
  return (match ?? entries[0])?.id;
}
