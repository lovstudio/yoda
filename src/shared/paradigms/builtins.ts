import { BUILTIN_TEAMS } from '../agent-team';
import { PARADIGM_KIND_IDS } from './contract';
import { PARADIGM_KINDS } from './kinds';
import { builtinParadigmId, type Paradigm } from './paradigm';
import { builtinTeamToParadigm } from './team-adapter';

/**
 * The instance a self-contained kind ships with: one per kind whose instances are
 * not sourced from somewhere else.
 *
 * A kind whose `instanceSource` names an external collection is excluded — its
 * instances *are* that collection, so synthesizing an extra one would put a
 * phantom entry in the picker.
 */
const KIND_OWNED_BUILTINS: readonly Paradigm[] = PARADIGM_KIND_IDS.filter(
  (kindId) => PARADIGM_KINDS[kindId].instanceSource === null
).map((kindId) => {
  const kind = PARADIGM_KINDS[kindId];
  return {
    id: builtinParadigmId(kindId),
    kindId,
    // Empty label and icon resolve to the kind's own localized name and glyph,
    // so a builtin instance needs no copy of its own.
    label: '',
    icon: '',
    params: kind.defaultParams,
    builtin: true,
    sortOrder: kind.pickerOrder,
    // Fixed rather than "now": a builtin's timestamps are a build-time fact, and
    // list ordering breaks ties on them.
    createdAt: '1970-01-01T00:00:00.000Z',
    updatedAt: '1970-01-01T00:00:00.000Z',
  } satisfies Paradigm;
});

/**
 * Every code-defined paradigm instance.
 *
 * The built-in Agent Teams are here rather than behind the team adapter because
 * they are not a different species: a built-in team is a code-defined instance of
 * the multi-agent kind, exactly as `builtin:paradigm:review` is one of the review
 * kind. Keeping them out would leave `paradigms.list()` missing instances that the
 * picker shows.
 *
 * These are defaults, not fixtures: `paradigmsService` overlays any stored row
 * with the same id on top, so a built-in can be renamed and reconfigured while
 * still being the instance the app ships and references by id.
 */
export const BUILTIN_PARADIGMS: readonly Paradigm[] = [
  ...KIND_OWNED_BUILTINS,
  ...BUILTIN_TEAMS.map(builtinTeamToParadigm),
];

export function builtinParadigm(id: string): Paradigm | undefined {
  return BUILTIN_PARADIGMS.find((paradigm) => paradigm.id === id);
}
