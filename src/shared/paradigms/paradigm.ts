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
  /**
   * Shipped with the app. It can be renamed, re-iconed, and reconfigured like any
   * other instance — the edits land in a row keyed by its own id — but it cannot
   * be deleted: the app ships expecting it to exist.
   */
  builtin: boolean;
  /**
   * A built-in carrying stored edits.
   *
   * Only meaningful for built-ins, and only because some of them ship with copy
   * the renderer localizes (the Agent Teams). That copy has to win while the
   * instance is pristine and lose the moment the user names it themselves, and
   * the label alone cannot say which of those is the case.
   */
  customized?: boolean;
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

/**
 * Marks any code-defined instance, whichever collection it came from. Built-in
 * Agent Teams already use this prefix (`builtin:review`), and once they are
 * paradigm instances they must keep reading as built-in here.
 */
export const BUILTIN_PARADIGM_ID_PREFIX = 'builtin:';

/**
 * Stable id of the instance a kind ships with.
 *
 * The kind id sits behind its own segment because the built-in namespace is
 * shared: `builtin:review` is already the review *team*, so a bare
 * `builtin:<kindId>` would collide with it the moment teams become instances.
 */
export function builtinParadigmId(kindId: ParadigmKindId): string {
  return `${BUILTIN_PARADIGM_ID_PREFIX}paradigm:${kindId}`;
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
