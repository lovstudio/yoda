import {
  BUILTIN_FEATURE_TEAM_ID,
  BUILTIN_REVIEW_TEAM_ID,
  BUILTIN_STARTUP_TEAM_ID,
  type AgentTeam,
} from '@shared/agent-team';
import {
  PARADIGM_KIND_IDS,
  type ParadigmIconId,
  type ParadigmKindId,
  type ParadigmPickerGroup,
} from '@shared/paradigms/contract';
import { PARADIGM_KINDS, paradigmKind } from '@shared/paradigms/kinds';

/**
 * One entry in the paradigm picker — a paradigm *instance*.
 *
 * A kind may surface as many entries: every Agent Team is its own `team` entry.
 * Identity therefore lives on the entry, not the kind. Entries are derived here
 * from the kind descriptors plus the Agent Teams; once instances are persisted
 * they come from that table instead and nothing downstream changes.
 */
export interface ParadigmEntry {
  /** Stable per-entry id — what the picker keys and selects on. */
  id: string;
  kindId: ParadigmKindId;
  /** Set on entries backed by an Agent Team. */
  teamId?: string;
  iconId: ParadigmIconId;
  /** Glyph, image URL, or data URL from the instance; wins over `iconId`. */
  avatar?: string;
  /** i18n key, for entries whose label is localized copy. */
  labelKey?: string;
  /** Literal label, for user-named instances. */
  label?: string;
  descKey: string;
  alpha?: boolean;
  pickerGroup: ParadigmPickerGroup;
  pickerOrder: number;
}

/**
 * Presentation overrides for the built-in Agent Teams: localized copy so the
 * picker reads naturally instead of echoing a template name, plus the placement
 * each one has always had. Feature is a team under the hood but belongs with the
 * converged workflows, which is exactly the kind of instance-level override the
 * entry carries.
 */
const BUILTIN_TEAM_PRESENTATION: Record<
  string,
  {
    labelKey: string;
    descKey: string;
    pickerGroup?: ParadigmPickerGroup;
    pickerOrder?: number;
    alpha?: boolean;
  }
> = {
  [BUILTIN_FEATURE_TEAM_ID]: {
    labelKey: 'home.modeTeamFeature',
    descKey: 'home.modeTeamFeatureDesc',
    pickerGroup: 'workflow',
    pickerOrder: 10,
  },
  [BUILTIN_REVIEW_TEAM_ID]: {
    labelKey: 'home.modeTeamReview',
    descKey: 'home.modeTeamReviewDesc',
    pickerOrder: 0,
  },
  [BUILTIN_STARTUP_TEAM_ID]: {
    labelKey: 'home.modeTeamStartup',
    descKey: 'home.modeTeamStartupDesc',
    pickerOrder: 10,
    // Honors the original "startup is alpha" call; the review team is GA.
    alpha: true,
  },
};

/** User teams sort after every pinned built-in, in list order. */
const USER_TEAM_ORDER_BASE = 100;

/** Display name for a team across the composer: localized for built-ins. */
export function teamDisplayName(team: AgentTeam, t: (key: string) => string): string {
  const presentation = BUILTIN_TEAM_PRESENTATION[team.id];
  return presentation ? t(presentation.labelKey) : team.name;
}

function teamEntry(team: AgentTeam, index: number): ParadigmEntry {
  const kind = paradigmKind('team');
  const presentation = BUILTIN_TEAM_PRESENTATION[team.id];
  return {
    id: `team:${team.id}`,
    kindId: 'team',
    teamId: team.id,
    iconId: kind.iconId,
    avatar: team.icon,
    ...(presentation ? { labelKey: presentation.labelKey } : { label: team.name }),
    descKey: presentation?.descKey ?? kind.descriptionKey,
    alpha: presentation?.alpha ?? kind.alpha,
    pickerGroup: presentation?.pickerGroup ?? 'multi-agent',
    pickerOrder: presentation?.pickerOrder ?? USER_TEAM_ORDER_BASE + index,
  };
}

function kindEntry(kindId: ParadigmKindId, pickerGroup: ParadigmPickerGroup): ParadigmEntry {
  const kind = paradigmKind(kindId);
  return {
    id: kindId,
    kindId,
    iconId: kind.iconId,
    labelKey: kind.labelKey,
    descKey: kind.descriptionKey,
    alpha: kind.alpha,
    pickerGroup,
    pickerOrder: kind.pickerOrder,
  };
}

/**
 * Every picker entry. A kind whose instances live in a table contributes one
 * entry per row; every other kind contributes a single implicit entry. Kinds with
 * no picker group contribute none.
 */
export function paradigmEntries(teams: AgentTeam[]): ParadigmEntry[] {
  return PARADIGM_KIND_IDS.flatMap((kindId) => {
    const kind = PARADIGM_KINDS[kindId];
    if (!kind.pickerGroup) return [];
    if (kind.instanceSource === 'agent-teams') return teams.map(teamEntry);
    return [kindEntry(kindId, kind.pickerGroup)];
  });
}

/** The picker's sections, in display order. Empty sections are dropped. */
const PICKER_GROUPS: readonly { group: ParadigmPickerGroup; labelKey: string }[] = [
  { group: 'workflow', labelKey: 'home.modeGroupWorkflow' },
  { group: 'multi-agent', labelKey: 'home.modeGroupMultiAgent' },
];

export function paradigmEntryGroups(
  entries: ParadigmEntry[]
): Array<{ labelKey: string; entries: ParadigmEntry[] }> {
  return PICKER_GROUPS.flatMap(({ group, labelKey }) => {
    const grouped = entries
      .filter((entry) => entry.pickerGroup === group)
      .sort((a, b) => a.pickerOrder - b.pickerOrder);
    return grouped.length > 0 ? [{ labelKey, entries: grouped }] : [];
  });
}

/**
 * The entry representing the committed selection. For instance-backed kinds the
 * instance id disambiguates which of the kind's many entries is active.
 */
export function paradigmEntryId(
  entries: ParadigmEntry[],
  kindId: ParadigmKindId,
  teamId: string
): string {
  const match =
    entries.find((entry) => entry.kindId === kindId && entry.teamId === teamId) ??
    entries.find((entry) => entry.kindId === kindId);
  return (match ?? entries[0]).id;
}
