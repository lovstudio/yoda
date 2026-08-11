import { randomUUID } from 'node:crypto';
import { asc, eq, sql } from 'drizzle-orm';
import { promptsUpdatedChannel } from '@shared/events/appEvents';
import {
  incrementPromptVersion,
  normalizePromptTags,
  promptBindingsSchema,
  promptCreateInputSchema,
  promptSourceSchema,
  promptTagSchema,
  promptUpdateInputSchema,
  type Prompt,
  type PromptBindings,
  type PromptCreateInput,
  type PromptSource,
  type PromptUpdateInput,
  type PromptVersionBump,
  type PromptVersionSnapshot,
} from '@shared/prompt-library';
import { appSettingsService } from '@main/core/settings/settings-service';
import { db } from '@main/db/client';
import { promptGroups, prompts, promptVersions } from '@main/db/schema';
import { events } from '@main/lib/events';

type PromptRow = typeof prompts.$inferSelect;
type PromptVersionRow = typeof promptVersions.$inferSelect;
type LegacyPromptGroupRow = Pick<typeof promptGroups.$inferSelect, 'name' | 'parentName'>;

function parseSource(value: string | null): PromptSource | undefined {
  if (!value) return undefined;
  try {
    const parsed = promptSourceSchema.safeParse(JSON.parse(value));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

function parseTags(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    const validTags = parsed.filter((tag): tag is string => typeof tag === 'string').slice(0, 32);
    return normalizePromptTags(validTags);
  } catch {
    return [];
  }
}

function parseBindings(value: string | null): PromptBindings {
  if (!value) return promptBindingsSchema.parse({});
  try {
    const parsed = promptBindingsSchema.safeParse(JSON.parse(value));
    return parsed.success ? parsed.data : promptBindingsSchema.parse({});
  } catch {
    return promptBindingsSchema.parse({});
  }
}

function toPrompt(row: PromptRow): Prompt {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    content: row.content,
    tags: parseTags(row.tagsJson),
    extraInfo: row.extraInfo,
    injectionEnabled: row.injectionEnabled,
    injectionOrder: row.injectionOrder,
    bindings: parseBindings(row.bindingsJson),
    version: row.version,
    source: parseSource(row.sourceJson),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toPromptVersion(row: PromptVersionRow): PromptVersionSnapshot {
  return {
    id: row.id,
    promptId: row.promptId,
    version: row.version,
    title: row.title,
    description: row.description,
    content: row.content,
    extraInfo: row.extraInfo,
    source: parseSource(row.sourceJson),
    createdAt: row.createdAt,
  };
}

function versionSnapshotValues(row: PromptRow): typeof promptVersions.$inferInsert {
  return {
    id: randomUUID(),
    promptId: row.id,
    version: row.version,
    title: row.title,
    description: row.description,
    content: row.content,
    extraInfo: row.extraInfo,
    sourceJson: row.sourceJson,
    createdAt: row.updatedAt,
  };
}

function compareSemanticVersions(left: string, right: string): number {
  const leftParts = left.split('.').map(Number);
  const rightParts = right.split('.').map(Number);
  for (let index = 0; index < 3; index += 1) {
    const difference = (rightParts[index] ?? 0) - (leftParts[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

function legacyGroupPath(
  groupName: string,
  groupsByName: ReadonlyMap<string, LegacyPromptGroupRow>
): string[] {
  const path: string[] = [];
  const visited = new Set<string>();
  let current: string | null = groupName.trim();
  while (current && !visited.has(current)) {
    visited.add(current);
    path.unshift(current);
    current = groupsByName.get(current)?.parentName?.trim() || null;
  }
  return path;
}

/**
 * The old library stored a prompt's group separately from its content. Keep
 * those columns for in-place upgrades, but expose one flat prompt model from
 * this point forward and turn the old hierarchy into human-facing tags once.
 */
export class PromptLibraryService {
  private async migrateLegacyGroupsToTags(): Promise<void> {
    const [groupRows, promptRows] = await Promise.all([
      db
        .select({ name: promptGroups.name, parentName: promptGroups.parentName })
        .from(promptGroups),
      db
        .select({ id: prompts.id, groupName: prompts.groupName, tagsJson: prompts.tagsJson })
        .from(prompts),
    ]);
    const groupsByName = new Map(groupRows.map((group) => [group.name.trim(), group]));
    const updates = promptRows
      .map((row) => {
        const legacyName = row.groupName.trim();
        if (!legacyName) return null;
        const legacyTags = legacyGroupPath(legacyName, groupsByName);
        const tags = normalizePromptTags([...parseTags(row.tagsJson), ...legacyTags]);
        return { id: row.id, tagsJson: JSON.stringify(tags) };
      })
      .filter((update): update is { id: string; tagsJson: string } => update !== null);

    if (updates.length === 0) return;
    db.transaction((tx) => {
      for (const update of updates) {
        tx.update(prompts)
          .set({ tagsJson: update.tagsJson, groupName: '' })
          .where(eq(prompts.id, update.id))
          .run();
      }
    });
  }

  private async syncInjectionOrder(): Promise<void> {
    const orderedPrompts = await db
      .select({ id: prompts.id })
      .from(prompts)
      .orderBy(asc(prompts.sortOrder), asc(prompts.createdAt));

    db.transaction((tx) => {
      orderedPrompts.forEach((prompt, index) => {
        tx.update(prompts).set({ injectionOrder: index }).where(eq(prompts.id, prompt.id)).run();
      });
    });
  }

  async initialize(): Promise<void> {
    const legacy = await appSettingsService.get('promptPrinciples');
    if (legacy.items.length > 0) {
      const [{ nextSortOrder }] = await db
        .select({ nextSortOrder: sql<number>`coalesce(min(${prompts.sortOrder}), 0) - 1` })
        .from(prompts);
      const [{ nextInjectionOrder }] = await db
        .select({
          nextInjectionOrder: sql<number>`coalesce(max(${prompts.injectionOrder}), -1) + 1`,
        })
        .from(prompts);
      const now = new Date().toISOString();

      await db
        .insert(prompts)
        .values(
          legacy.items.map((item, index) => ({
            id: item.id,
            title: item.name,
            description: '',
            content: item.text,
            groupName: '',
            tagsJson: '[]',
            extraInfo: '',
            injectionEnabled: item.enabled,
            injectionOrder: (nextInjectionOrder ?? 0) + index,
            bindingsJson: JSON.stringify({ global: true, workspaceIds: [], projectIds: [] }),
            sortOrder: (nextSortOrder ?? 0) + index,
            version: '1.0.0',
            sourceJson: item.source ? JSON.stringify(item.source) : null,
            createdAt: now,
            updatedAt: now,
          }))
        )
        .onConflictDoNothing();

      await appSettingsService.update('promptPrinciples', { items: [] });
      events.emit(promptsUpdatedChannel, undefined);
    }

    await this.migrateLegacyGroupsToTags();

    const [promptRows, versionRows] = await Promise.all([
      db.select().from(prompts),
      db
        .select({ promptId: promptVersions.promptId, version: promptVersions.version })
        .from(promptVersions),
    ]);
    const existingVersions = new Set(
      versionRows.map((row) => `${row.promptId}\u0000${row.version}`)
    );
    const missingSnapshots = promptRows
      .filter((row) => !existingVersions.has(`${row.id}\u0000${row.version}`))
      .map(versionSnapshotValues);
    if (missingSnapshots.length > 0) {
      await db.insert(promptVersions).values(missingSnapshots).onConflictDoNothing();
    }
    await this.syncInjectionOrder();
  }

  async list(): Promise<Prompt[]> {
    const rows = await db
      .select()
      .from(prompts)
      .orderBy(asc(prompts.sortOrder), asc(prompts.createdAt));
    return rows.map(toPrompt);
  }

  async listVersions(id: string): Promise<PromptVersionSnapshot[]> {
    const rows = await db.select().from(promptVersions).where(eq(promptVersions.promptId, id));
    return rows
      .sort((left, right) => compareSemanticVersions(left.version, right.version))
      .map(toPromptVersion);
  }

  async create(input: PromptCreateInput): Promise<Prompt> {
    const parsed = promptCreateInputSchema.parse(input);
    const now = new Date().toISOString();
    const [{ next }] = await db
      .select({ next: sql<number>`coalesce(min(${prompts.sortOrder}), 0) - 1` })
      .from(prompts);
    const row = {
      id: randomUUID(),
      title: parsed.title,
      description: parsed.description,
      content: parsed.content,
      groupName: '',
      tagsJson: JSON.stringify(normalizePromptTags(parsed.tags)),
      extraInfo: parsed.extraInfo,
      injectionEnabled: parsed.injectionEnabled,
      injectionOrder: 0,
      bindingsJson: JSON.stringify(parsed.bindings),
      version: '1.0.0',
      sourceJson: parsed.source ? JSON.stringify(parsed.source) : null,
      sortOrder: next ?? 0,
      createdAt: now,
      updatedAt: now,
    };
    db.transaction((tx) => {
      tx.insert(prompts).values(row).run();
      tx.insert(promptVersions).values(versionSnapshotValues(row)).run();
    });
    await this.syncInjectionOrder();
    events.emit(promptsUpdatedChannel, undefined);
    const [created] = await db.select().from(prompts).where(eq(prompts.id, row.id)).limit(1);
    return toPrompt(created);
  }

  async update(id: string, patch: PromptUpdateInput): Promise<Prompt | null> {
    const parsed = promptUpdateInputSchema.parse(patch);
    if (Object.keys(parsed).length > 0) {
      const [current] = await db.select().from(prompts).where(eq(prompts.id, id)).limit(1);
      if (!current) return null;
      const { source, tags, bindings, versionBump, ...fields } = parsed;
      const authoredContentChanged =
        (parsed.title !== undefined && parsed.title !== current.title) ||
        (parsed.description !== undefined && parsed.description !== current.description) ||
        (parsed.content !== undefined && parsed.content !== current.content) ||
        (parsed.extraInfo !== undefined && parsed.extraInfo !== current.extraInfo);
      const nextVersion = authoredContentChanged
        ? incrementPromptVersion(current.version, versionBump ?? 'patch')
        : current.version;
      const update = {
        ...fields,
        ...(tags !== undefined ? { tagsJson: JSON.stringify(normalizePromptTags(tags)) } : {}),
        ...(bindings !== undefined ? { bindingsJson: JSON.stringify(bindings) } : {}),
        ...(source !== undefined ? { sourceJson: source ? JSON.stringify(source) : null } : {}),
        ...(authoredContentChanged ? { version: nextVersion } : {}),
      };
      db.transaction((tx) => {
        const [updated] = tx
          .update(prompts)
          .set(update)
          .where(eq(prompts.id, id))
          .returning()
          .all();
        if (authoredContentChanged && updated) {
          tx.insert(promptVersions).values(versionSnapshotValues(updated)).run();
        }
      });
    }
    events.emit(promptsUpdatedChannel, undefined);
    const [row] = await db.select().from(prompts).where(eq(prompts.id, id)).limit(1);
    return row ? toPrompt(row) : null;
  }

  async restoreVersion(
    id: string,
    version: string,
    bump: PromptVersionBump = 'patch'
  ): Promise<Prompt | null> {
    const [snapshot] = await db
      .select()
      .from(promptVersions)
      .where(sql`${promptVersions.promptId} = ${id} AND ${promptVersions.version} = ${version}`)
      .limit(1);
    if (!snapshot) throw new Error('Prompt version not found');
    return this.update(id, {
      title: snapshot.title,
      description: snapshot.description,
      content: snapshot.content,
      extraInfo: snapshot.extraInfo,
      source: parseSource(snapshot.sourceJson) ?? null,
      versionBump: bump,
    });
  }

  async remove(id: string): Promise<void> {
    await db.delete(prompts).where(eq(prompts.id, id));
    await this.syncInjectionOrder();
    events.emit(promptsUpdatedChannel, undefined);
  }

  async setTagInjectionEnabled(tag: string, enabled: boolean): Promise<void> {
    const normalizedTag = promptTagSchema.parse(tag);
    const rows = await db.select({ id: prompts.id, tagsJson: prompts.tagsJson }).from(prompts);
    const matchingIds = rows
      .filter((row) => parseTags(row.tagsJson).includes(normalizedTag))
      .map((row) => row.id);
    if (matchingIds.length > 0) {
      db.transaction((tx) => {
        for (const id of matchingIds) {
          tx.update(prompts).set({ injectionEnabled: enabled }).where(eq(prompts.id, id)).run();
        }
      });
    }
    events.emit(promptsUpdatedChannel, undefined);
  }

  async removeTag(tag: string): Promise<void> {
    const normalizedTag = promptTagSchema.parse(tag);
    const rows = await db.select({ id: prompts.id, tagsJson: prompts.tagsJson }).from(prompts);
    const updates = rows
      .map((row) => {
        const tags = parseTags(row.tagsJson);
        if (!tags.includes(normalizedTag)) return null;
        return {
          id: row.id,
          tagsJson: JSON.stringify(tags.filter((value) => value !== normalizedTag)),
        };
      })
      .filter((update): update is { id: string; tagsJson: string } => update !== null);

    if (updates.length === 0) return;
    db.transaction((tx) => {
      for (const update of updates) {
        tx.update(prompts)
          .set({ tagsJson: update.tagsJson })
          .where(eq(prompts.id, update.id))
          .run();
      }
    });
    events.emit(promptsUpdatedChannel, undefined);
  }

  async reorderPrompts(ids: string[]): Promise<void> {
    const uniqueIds = [...new Set(ids)];
    if (uniqueIds.length !== ids.length) {
      throw new Error('Prompt order contains duplicates');
    }

    const existing = await db.select({ id: prompts.id }).from(prompts);
    const existingIds = new Set(existing.map((row) => row.id));
    if (uniqueIds.length !== existingIds.size || uniqueIds.some((id) => !existingIds.has(id))) {
      throw new Error('Prompt order must contain every prompt');
    }
    db.transaction((tx) => {
      uniqueIds.forEach((id, index) => {
        tx.update(prompts).set({ sortOrder: index }).where(eq(prompts.id, id)).run();
      });
    });
    await this.syncInjectionOrder();
    events.emit(promptsUpdatedChannel, undefined);
  }
}

export const promptLibraryService = new PromptLibraryService();
