import type { ParadigmIconId, ParadigmKindId } from './contract';

/**
 * A paradigm instance — the data half of the contract.
 *
 * One kind may have many instances: today every Agent Team is its own picker
 * entry, and after the paradigms table lands that generalizes to every kind.
 * An instance carries presentation (label, icon) plus the kind's params, so
 * duplicating one duplicates its behavior.
 */
export interface Paradigm {
  id: string;
  kindId: ParadigmKindId;
  /** User-visible name. Empty means "use the kind's own localized label". */
  label: string;
  /** Emoji/glyph, image URL, or data URL. Empty falls back to the kind icon. */
  icon: string;
  /** Validated against the kind's `paramsSchema`. */
  params: unknown;
  /** Code-defined instances are not editable or deletable. */
  builtin: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface ParadigmDraft {
  kindId: ParadigmKindId;
  label: string;
  icon: string;
  params: unknown;
}

export const BUILTIN_PARADIGM_ID_PREFIX = 'builtin:';

/** Stable id of the code-defined instance every kind ships with. */
export function builtinParadigmId(kindId: ParadigmKindId): string {
  return `${BUILTIN_PARADIGM_ID_PREFIX}${kindId}`;
}

export function isBuiltinParadigmId(id: string): boolean {
  return id.startsWith(BUILTIN_PARADIGM_ID_PREFIX);
}

/** Icon actually rendered for an instance: its own, else its kind's. */
export function paradigmIcon(
  paradigm: Pick<Paradigm, 'icon'>,
  kindIconId: ParadigmIconId
): { avatar: string } | { iconId: ParadigmIconId } {
  return paradigm.icon ? { avatar: paradigm.icon } : { iconId: kindIconId };
}
