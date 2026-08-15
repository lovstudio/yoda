import { PARADIGM_KIND_IDS } from './contract';
import { PARADIGM_KINDS } from './kinds';
import { builtinParadigmId, type Paradigm } from './paradigm';

/**
 * The instance every kind ships with — exactly one each.
 *
 * A kind is always reachable: it is a way of working, so it must be pickable
 * before the user has configured anything. Extra instances of the same kind are
 * user rows, created by duplicating this one.
 */
const KIND_OWNED_BUILTINS: readonly Paradigm[] = PARADIGM_KIND_IDS.map((kindId) => {
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
 */
export const BUILTIN_PARADIGMS: readonly Paradigm[] = KIND_OWNED_BUILTINS;

export function builtinParadigm(id: string): Paradigm | undefined {
  return BUILTIN_PARADIGMS.find((paradigm) => paradigm.id === id);
}
