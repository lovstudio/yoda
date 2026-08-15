import { PARADIGM_KIND_IDS } from './contract';
import { PARADIGM_KINDS } from './kinds';
import { builtinParadigmId, type Paradigm } from './paradigm';

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
 * These are defaults, not fixtures: `paradigmsService` overlays any stored row
 * with the same id on top, so a built-in can be renamed and reconfigured while
 * still being the instance the app ships and references by id.
 *
 * The multi-agent kind contributes nothing here — its instances *are* the user's
 * Agent Teams, and the app ships none of those.
 */
export const BUILTIN_PARADIGMS: readonly Paradigm[] = KIND_OWNED_BUILTINS;

export function builtinParadigm(id: string): Paradigm | undefined {
  return BUILTIN_PARADIGMS.find((paradigm) => paradigm.id === id);
}
