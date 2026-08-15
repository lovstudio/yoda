import { randomUUID } from 'node:crypto';
import { asc, desc, eq } from 'drizzle-orm';
import { normalizeTeamRouting } from '@shared/agent-team';
import { BUILTIN_PARADIGMS, builtinParadigm } from '@shared/paradigms/builtins';
import { isParadigmKindId, type ParadigmKindId } from '@shared/paradigms/contract';
import { PARADIGM_KINDS } from '@shared/paradigms/kinds';
import { isBuiltinParadigmId, type Paradigm, type ParadigmDraft } from '@shared/paradigms/paradigm';
import { teamToParadigmDraft } from '@shared/paradigms/team-adapter';
import { db } from '@main/db/client';
import { KV } from '@main/db/kv';
import { agentTeams, paradigms, type ParadigmRow } from '@main/db/schema';
import { log } from '@main/lib/logger';

/** Records the one-time `agent_teams` fold-in so it never runs twice. */
const migrationKV = new KV<{ agentTeamsMigratedAt: string }>('paradigms');

/**
 * Params a kind will accept, or its defaults.
 *
 * The read path is deliberately forgiving: a row written by a newer build, or by
 * a kind whose schema has since tightened, still yields a usable instance rather
 * than failing the whole list. The write path is strict — see `sanitizeDraft`.
 */
function readParams(kindId: ParadigmKindId, raw: unknown): unknown {
  const kind = PARADIGM_KINDS[kindId];
  const parsed = kind.paramsSchema.safeParse(raw);
  if (parsed.success) return parsed.data;
  log.warn(
    `[paradigms] dropping unreadable params for kind "${kindId}": ${parsed.error.message}; falling back to defaults`
  );
  return kind.defaultParams;
}

function rowToParadigm(row: ParadigmRow): Paradigm {
  // A row whose kind no longer exists is pinned to `single` so it stays visible
  // and editable instead of vanishing from the picker with no explanation.
  const kindId = isParadigmKindId(row.kindId) ? row.kindId : 'single';
  if (kindId !== row.kindId)
    log.warn(`[paradigms] row ${row.id} names unknown kind "${row.kindId}"; treating as "single"`);
  return {
    id: row.id,
    kindId,
    label: row.label,
    icon: row.icon,
    params: readParams(kindId, row.params),
    // A row under a built-in id is an override for a built-in that this build no
    // longer ships. Still built-in, so `remove` keeps refusing it — deleting it
    // here would be deleting an edit to something the user cannot get back.
    builtin: isBuiltinParadigmId(row.id),
    sortOrder: row.sortOrder,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * A shipped instance with the user's edits applied.
 *
 * A built-in is a default, not a fixed thing: it can be renamed, re-iconed and
 * reconfigured like any other instance, and those edits live in a row keyed by the
 * built-in's own id. Identity and rank stay with the code — the id is what rooms
 * and drafts reference, and the picker's shipped ordering should not shift because
 * something was renamed.
 */
function overlayBuiltin(builtin: Paradigm, row: ParadigmRow | undefined): Paradigm {
  if (!row) return builtin;
  const named = row.label.length > 0;
  return {
    ...builtin,
    // An emptied field is a reset, not a blank: a built-in's name and glyph are
    // either the user's or the ones it shipped with, and clearing them is the only
    // way back — there is no third state worth having, and a team with no name at
    // all is one every room would display as nothing.
    label: named ? row.label : builtin.label,
    icon: row.icon || builtin.icon,
    params: readParams(builtin.kindId, row.params),
    ...(named ? { customized: true } : {}),
    updatedAt: row.updatedAt,
  };
}

function sanitizeDraft(draft: ParadigmDraft): ParadigmDraft & { kindId: ParadigmKindId } {
  if (!isParadigmKindId(draft.kindId)) throw new Error(`Unknown paradigm kind "${draft.kindId}"`);
  const kind = PARADIGM_KINDS[draft.kindId];
  const parsed = kind.paramsSchema.safeParse(draft.params);
  if (!parsed.success)
    throw new Error(`Invalid params for paradigm kind "${draft.kindId}": ${parsed.error.message}`);
  return {
    kindId: draft.kindId,
    // Empty label/icon are meaningful: they defer to the kind's own name and glyph.
    label: draft.label.trim(),
    icon: draft.icon.trim(),
    params: parsed.data,
  };
}

class ParadigmsService {
  private teamMigration: Promise<void> | null = null;

  /**
   * Folds `agent_teams` into this table, once.
   *
   * Teams keep their ids: rooms reference them, so re-keying would orphan every
   * existing room. The completion flag is what makes this safe to leave in place
   * — `agent_teams` stays readable for a release as a fallback, and without the
   * flag every launch would resurrect teams the user deleted after migrating.
   */
  private async ensureTeamsMigrated(): Promise<void> {
    this.teamMigration ??= (async () => {
      if (await migrationKV.get('agentTeamsMigratedAt')) return;
      const rows = await db.select().from(agentTeams).execute();
      if (rows.length > 0) {
        await db
          .insert(paradigms)
          .values(
            rows.map((row) => {
              const draft = teamToParadigmDraft({
                name: row.name,
                icon: row.icon,
                routing: normalizeTeamRouting(row.routing),
                communication: row.communication,
                routingHopLimit: row.routingHopLimit,
                members: row.members,
              });
              return {
                id: row.id,
                kindId: 'team' as const,
                label: draft.label,
                icon: draft.icon,
                params: draft.params,
                // Carried over so the picker's ordering does not reshuffle on upgrade.
                createdAt: row.createdAt,
                updatedAt: row.updatedAt,
              };
            })
          )
          // Idempotent even if the flag write below never landed.
          .onConflictDoNothing()
          .execute();
        log.info(`[paradigms] migrated ${rows.length} Agent Team(s) into paradigms`);
      }
      await migrationKV.setStrict('agentTeamsMigratedAt', new Date().toISOString());
    })().catch((error) => {
      // Left unflagged so the next launch retries; a failed migration must not
      // present a half-migrated list as complete.
      this.teamMigration = null;
      log.warn(`[paradigms] Agent Team migration failed: ${String(error)}`);
    });
    return this.teamMigration;
  }

  /** Shipped instances first, then the user's (by rank, newest tie-break). */
  async list(): Promise<Paradigm[]> {
    await this.ensureTeamsMigrated();
    const rows = await db
      .select()
      .from(paradigms)
      .orderBy(asc(paradigms.sortOrder), desc(paradigms.updatedAt))
      .execute();
    const byId = new Map(rows.map((row) => [row.id, row]));
    return [
      ...BUILTIN_PARADIGMS.map((builtin) => overlayBuiltin(builtin, byId.get(builtin.id))),
      // Rows consumed as overrides above are not instances of their own; listing
      // them again would double every edited built-in.
      ...rows.filter((row) => !builtinParadigm(row.id)).map(rowToParadigm),
    ];
  }

  async get(id: string): Promise<Paradigm | null> {
    await this.ensureTeamsMigrated();
    const [row] = await db.select().from(paradigms).where(eq(paradigms.id, id)).execute();
    const builtin = builtinParadigm(id);
    if (builtin) return overlayBuiltin(builtin, row);
    return row ? rowToParadigm(row) : null;
  }

  async create(draft: ParadigmDraft): Promise<Paradigm> {
    const clean = sanitizeDraft(draft);
    const id = randomUUID();
    await db
      .insert(paradigms)
      .values({
        id,
        kindId: clean.kindId,
        label: clean.label,
        icon: clean.icon,
        params: clean.params,
      })
      .execute();
    const created = await this.get(id);
    if (!created) throw new Error('Failed to read back created paradigm');
    return created;
  }

  /**
   * A built-in is editable here. Its edits are written as a row under its own id —
   * an overlay on the shipped default rather than a copy of it — so renaming the
   * paradigm the user actually works in does not first require duplicating it into
   * a near-identical row.
   *
   * A user paradigm may change kind. A paradigm is a set of Agents, and the kinds
   * are only two ways of storing that set (one seat vs. a members array), so growing
   * from one Agent to two has to be allowed to cross between them — `sanitizeDraft`
   * validates the params against the *incoming* kind, so what lands is coherent.
   *
   * A built-in may not, and that is the one asymmetry: its id is a shipped constant
   * that other params point at (`compare` defaults to `builtin:paradigm:single`), and
   * `overlayBuiltin` reads a row's params through the kind the code ships — so a
   * migrated built-in would both break those references and read back as its old
   * kind anyway. Callers duplicate first and migrate the copy.
   */
  async update(id: string, draft: ParadigmDraft): Promise<Paradigm> {
    const existing = await this.get(id);
    if (!existing) throw new Error(`Paradigm ${id} not found`);
    if (draft.kindId !== existing.kindId && existing.builtin)
      throw new Error(
        `Paradigm ${id} is a built-in "${existing.kindId}" paradigm; its kind cannot be changed. Duplicate it first.`
      );
    const clean = sanitizeDraft(draft);
    await db
      .insert(paradigms)
      .values({
        id,
        kindId: clean.kindId,
        label: clean.label,
        icon: clean.icon,
        params: clean.params,
        // Shipped rank, so an edited built-in keeps its place in the picker.
        sortOrder: existing.sortOrder,
      })
      // Covers a built-in's first edit and every edit after it, without the caller
      // having to know whether a row exists yet. `$onUpdate` does not fire on
      // conflict, so the timestamp is set here.
      .onConflictDoUpdate({
        target: paradigms.id,
        set: {
          // Written on conflict too: a user paradigm that grew past one Agent lands
          // here with a new kind, and leaving the old one would pair it with params
          // the reader no longer knows how to parse.
          kindId: clean.kindId,
          label: clean.label,
          icon: clean.icon,
          params: clean.params,
          updatedAt: new Date().toISOString(),
        },
      })
      .execute();
    const updated = await this.get(id);
    if (!updated) throw new Error(`Paradigm ${id} not found`);
    return updated;
  }

  /**
   * A shipped paradigm cannot be deleted — the app expects it to exist, and rooms
   * and drafts reference its id. Clearing its name and icon restores the shipped
   * copy, which is the reset this would otherwise be for.
   */
  async remove(id: string): Promise<void> {
    if (isBuiltinParadigmId(id)) throw new Error('Built-in paradigms cannot be removed.');
    await db.delete(paradigms).where(eq(paradigms.id, id)).execute();
  }

  /** Duplicate any paradigm (built-in or user) into an editable user instance. */
  async duplicate(id: string): Promise<Paradigm> {
    const source = await this.get(id);
    if (!source) throw new Error(`Paradigm ${id} not found`);
    return this.create({
      kindId: source.kindId,
      // A builtin has no label of its own, so the copy is seeded from the kind id
      // rather than inheriting an empty string that would read as the original.
      // Unlocalized on purpose: main cannot resolve i18n keys, and the user is
      // renaming it anyway.
      label: `${source.label || source.kindId} copy`,
      icon: source.icon,
      params: source.params,
    });
  }
}

export const paradigmsService = new ParadigmsService();
