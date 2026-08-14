import { PARADIGM_KIND_IDS } from './contract';
import { PARADIGM_KINDS } from './kinds';
import { builtinParadigmId, type Paradigm } from './paradigm';

/**
 * The code-defined paradigm instance every self-contained kind ships with.
 *
 * A kind whose `instanceSource` names an external collection has no builtin row
 * here — its instances *are* that collection (today: one per Agent Team), so
 * synthesizing an extra one would put a phantom entry in the picker.
 *
 * These are not stored: they carry no user edits, so persisting them would only
 * create rows to keep in sync. `paradigmsService.list()` prepends them to the
 * user's rows the same way `agentTeamsService` prepends `BUILTIN_TEAMS`.
 */
export const BUILTIN_PARADIGMS: readonly Paradigm[] = PARADIGM_KIND_IDS.filter(
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

export function builtinParadigm(id: string): Paradigm | undefined {
  return BUILTIN_PARADIGMS.find((paradigm) => paradigm.id === id);
}
