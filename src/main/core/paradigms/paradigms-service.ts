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
    builtin: false,
    sortOrder: row.sortOrder,
    createdAt: row.createdAt,
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

  /** Code-defined instances first, then the user's (by rank, newest tie-break). */
  async list(): Promise<Paradigm[]> {
    await this.ensureTeamsMigrated();
    const rows = await db
      .select()
      .from(paradigms)
      .orderBy(asc(paradigms.sortOrder), desc(paradigms.updatedAt))
      .execute();
    return [...BUILTIN_PARADIGMS, ...rows.map(rowToParadigm)];
  }

  async get(id: string): Promise<Paradigm | null> {
    const builtin = builtinParadigm(id);
    if (builtin) return builtin;
    await this.ensureTeamsMigrated();
    const [row] = await db.select().from(paradigms).where(eq(paradigms.id, id)).execute();
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
   * A paradigm's kind is immutable: params are shaped by it, so switching kinds
   * would silently invalidate them. Duplicate into the other kind instead.
   */
  async update(id: string, draft: ParadigmDraft): Promise<Paradigm> {
    if (isBuiltinParadigmId(id))
      throw new Error('Built-in paradigms cannot be edited; duplicate it first.');
    const existing = await this.get(id);
    if (!existing) throw new Error(`Paradigm ${id} not found`);
    if (draft.kindId !== existing.kindId)
      throw new Error(
        `Paradigm ${id} is a "${existing.kindId}" paradigm; its kind cannot be changed.`
      );
    const clean = sanitizeDraft(draft);
    await db
      .update(paradigms)
      .set({ label: clean.label, icon: clean.icon, params: clean.params })
      .where(eq(paradigms.id, id))
      .execute();
    const updated = await this.get(id);
    if (!updated) throw new Error(`Paradigm ${id} not found`);
    return updated;
  }

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
