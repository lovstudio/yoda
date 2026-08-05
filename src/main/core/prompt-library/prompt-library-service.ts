import { randomUUID } from 'node:crypto';
import { asc, eq, isNull, ne, sql } from 'drizzle-orm';
import { promptsUpdatedChannel } from '@shared/events/appEvents';
import {
  promptCreateInputSchema,
  promptGroupNameSchema,
  promptSourceSchema,
  promptUpdateInputSchema,
  type Prompt,
  type PromptCreateInput,
  type PromptGroup,
  type PromptSource,
  type PromptUpdateInput,
} from '@shared/prompt-library';
import { appSettingsService } from '@main/core/settings/settings-service';
import { db } from '@main/db/client';
import { promptGroups, prompts } from '@main/db/schema';
import { events } from '@main/lib/events';

type PromptRow = typeof prompts.$inferSelect;
type PromptGroupRow = typeof promptGroups.$inferSelect;

function orderPromptGroups(rows: PromptGroupRow[]): PromptGroupRow[] {
  const children = new Map<string | null, PromptGroupRow[]>();
  for (const row of rows) {
    const siblings = children.get(row.parentName) ?? [];
    siblings.push(row);
    children.set(row.parentName, siblings);
  }
  for (const siblings of children.values()) {
    siblings.sort(
      (left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name)
    );
  }

  const ordered: PromptGroupRow[] = [];
  const visited = new Set<string>();
  const visit = (parentName: string | null): void => {
    for (const row of children.get(parentName) ?? []) {
      if (visited.has(row.name)) continue;
      visited.add(row.name);
      ordered.push(row);
      visit(row.name);
    }
  };
  visit(null);
  for (const row of rows) {
    if (!visited.has(row.name)) {
      visited.add(row.name);
      ordered.push(row);
      visit(row.name);
    }
  }
  return ordered;
}

function parseSource(value: string | null): PromptSource | undefined {
  if (!value) return undefined;
  try {
    const parsed = promptSourceSchema.safeParse(JSON.parse(value));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

function toPrompt(row: PromptRow): Prompt {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    content: row.content,
    groupName: row.groupName,
    extraInfo: row.extraInfo,
    injectionEnabled: row.injectionEnabled,
    injectionOrder: row.injectionOrder,
    source: parseSource(row.sourceJson),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * The `prompts` table is the single source of truth for reusable and dynamically
 * injected prompts. Legacy app-global principles are migrated here once.
 */
export class PromptLibraryService {
  private async syncInjectionOrder(): Promise<void> {
    const [unorderedGroupRows, promptRows] = await Promise.all([
      db.select().from(promptGroups),
      db
        .select({
          id: prompts.id,
          groupName: prompts.groupName,
        })
        .from(prompts)
        .orderBy(asc(prompts.sortOrder), asc(prompts.createdAt)),
    ]);
    const groupRows = orderPromptGroups(unorderedGroupRows);
    const groupOrder = new Map(groupRows.map((row, index) => [row.name, index]));
    const orderedPrompts = promptRows.slice().sort((left, right) => {
      const leftGroup = left.groupName.trim();
      const rightGroup = right.groupName.trim();
      const leftRank = leftGroup ? (groupOrder.get(leftGroup) ?? groupRows.length) : Infinity;
      const rightRank = rightGroup ? (groupOrder.get(rightGroup) ?? groupRows.length) : Infinity;
      return leftRank - rightRank;
    });

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
        .select({ nextSortOrder: sql<number>`coalesce(max(${prompts.sortOrder}), -1) + 1` })
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
            extraInfo: '',
            injectionEnabled: item.enabled,
            injectionOrder: (nextInjectionOrder ?? 0) + index,
            sourceJson: item.source ? JSON.stringify(item.source) : null,
            sortOrder: (nextSortOrder ?? 0) + index,
            createdAt: now,
            updatedAt: now,
          }))
        )
        .onConflictDoNothing();

      await appSettingsService.update('promptPrinciples', { items: [] });
      events.emit(promptsUpdatedChannel, undefined);
    }

    const existingGroupNames = await db
      .selectDistinct({ name: prompts.groupName })
      .from(prompts)
      .where(ne(prompts.groupName, ''));
    if (existingGroupNames.length > 0) {
      const [{ nextSortOrder }] = await db
        .select({
          nextSortOrder: sql<number>`coalesce(max(${promptGroups.sortOrder}), -1) + 1`,
        })
        .from(promptGroups);
      await db
        .insert(promptGroups)
        .values(
          existingGroupNames
            .map((row) => row.name.trim())
            .filter(Boolean)
            .sort((left, right) => left.localeCompare(right))
            .map((name, index) => ({
              name,
              sortOrder: (nextSortOrder ?? 0) + index,
            }))
        )
        .onConflictDoNothing({ target: promptGroups.name });
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

  async listGroups(): Promise<PromptGroup[]> {
    const rows = orderPromptGroups(await db.select().from(promptGroups));
    return rows.map(({ name, parentName }) => ({ name, parentName }));
  }

  async createGroup(name: string, parentName?: string | null): Promise<string> {
    const parsed = promptGroupNameSchema.parse(name);
    const normalizedParentName = parentName ? promptGroupNameSchema.parse(parentName) : null;
    if (normalizedParentName === parsed) throw new Error('Prompt group cannot contain itself');
    if (normalizedParentName) await this.requireGroup(normalizedParentName);
    await this.ensureGroup(parsed, normalizedParentName);
    events.emit(promptsUpdatedChannel, undefined);
    return parsed;
  }

  async renameGroup(currentName: string, nextName: string): Promise<string> {
    const current = promptGroupNameSchema.parse(currentName);
    const next = promptGroupNameSchema.parse(nextName);
    if (current === next) return current;

    const [existing, collision] = await Promise.all([
      db
        .select({ name: promptGroups.name })
        .from(promptGroups)
        .where(eq(promptGroups.name, current))
        .limit(1),
      db
        .select({ name: promptGroups.name })
        .from(promptGroups)
        .where(eq(promptGroups.name, next))
        .limit(1),
    ]);
    if (!existing[0]) throw new Error('Prompt group not found');
    if (collision[0]) throw new Error('Prompt group already exists');

    db.transaction((tx) => {
      tx.update(promptGroups).set({ name: next }).where(eq(promptGroups.name, current)).run();
      tx.update(promptGroups)
        .set({ parentName: next })
        .where(eq(promptGroups.parentName, current))
        .run();
      tx.update(prompts)
        .set({ groupName: next })
        .where(sql`trim(${prompts.groupName}) = ${current}`)
        .run();
    });
    await this.syncInjectionOrder();
    events.emit(promptsUpdatedChannel, undefined);
    return next;
  }

  private async requireGroup(name: string): Promise<PromptGroupRow> {
    const [row] = await db.select().from(promptGroups).where(eq(promptGroups.name, name)).limit(1);
    if (!row) throw new Error('Prompt group not found');
    return row;
  }

  private async nextGroupSortOrder(parentName: string | null): Promise<number> {
    const [{ nextSortOrder }] = await db
      .select({
        nextSortOrder: sql<number>`coalesce(max(${promptGroups.sortOrder}), -1) + 1`,
      })
      .from(promptGroups)
      .where(
        parentName === null
          ? isNull(promptGroups.parentName)
          : eq(promptGroups.parentName, parentName)
      );
    return nextSortOrder ?? 0;
  }

  private async ensureGroup(name: string, parentName: string | null = null): Promise<void> {
    const normalized = name.trim();
    if (!normalized) return;
    const nextSortOrder = await this.nextGroupSortOrder(parentName);
    await db
      .insert(promptGroups)
      .values({
        name: promptGroupNameSchema.parse(normalized),
        parentName,
        sortOrder: nextSortOrder,
      })
      .onConflictDoNothing({ target: promptGroups.name });
  }

  async moveGroup(name: string, parentName: string | null): Promise<void> {
    const normalizedName = promptGroupNameSchema.parse(name);
    const normalizedParentName = parentName ? promptGroupNameSchema.parse(parentName) : null;
    const group = await this.requireGroup(normalizedName);
    if (group.parentName === normalizedParentName) return;
    if (normalizedName === normalizedParentName)
      throw new Error('Prompt group cannot contain itself');

    let cursor = normalizedParentName;
    const visited = new Set<string>();
    while (cursor) {
      if (cursor === normalizedName) throw new Error('Prompt group nesting would create a cycle');
      if (visited.has(cursor)) throw new Error('Prompt group nesting contains a cycle');
      visited.add(cursor);
      const parent = await this.requireGroup(cursor);
      cursor = parent.parentName;
    }

    await db
      .update(promptGroups)
      .set({
        parentName: normalizedParentName,
        sortOrder: await this.nextGroupSortOrder(normalizedParentName),
      })
      .where(eq(promptGroups.name, normalizedName));
    await this.syncInjectionOrder();
    events.emit(promptsUpdatedChannel, undefined);
  }

  async removeGroup(name: string): Promise<void> {
    const normalizedName = promptGroupNameSchema.parse(name);
    const group = await this.requireGroup(normalizedName);
    const children = await db
      .select()
      .from(promptGroups)
      .where(eq(promptGroups.parentName, normalizedName))
      .orderBy(asc(promptGroups.sortOrder), asc(promptGroups.name));
    const nextSortOrder = await this.nextGroupSortOrder(group.parentName);
    const groupPrompts = await db
      .select({ id: prompts.id })
      .from(prompts)
      .where(sql`trim(${prompts.groupName}) = ${normalizedName}`)
      .orderBy(asc(prompts.sortOrder), asc(prompts.createdAt));
    const [{ nextPromptSortOrder }] = await db
      .select({
        nextPromptSortOrder: sql<number>`coalesce(max(${prompts.sortOrder}), -1) + 1`,
      })
      .from(prompts)
      .where(sql`trim(${prompts.groupName}) = ''`);

    db.transaction((tx) => {
      children.forEach((child, index) => {
        tx.update(promptGroups)
          .set({ parentName: group.parentName, sortOrder: nextSortOrder + index })
          .where(eq(promptGroups.name, child.name))
          .run();
      });
      groupPrompts.forEach((prompt, index) => {
        tx.update(prompts)
          .set({ groupName: '', sortOrder: (nextPromptSortOrder ?? 0) + index })
          .where(eq(prompts.id, prompt.id))
          .run();
      });
      tx.delete(promptGroups).where(eq(promptGroups.name, normalizedName)).run();
    });
    await this.syncInjectionOrder();
    events.emit(promptsUpdatedChannel, undefined);
  }

  async create(input: PromptCreateInput): Promise<Prompt> {
    const parsed = promptCreateInputSchema.parse(input);
    const groupName = parsed.groupName.trim();
    await this.ensureGroup(groupName);
    const now = new Date().toISOString();
    // Prepend new entries inside their selected group.
    const [{ next }] = await db
      .select({ next: sql<number>`coalesce(min(${prompts.sortOrder}), 0) - 1` })
      .from(prompts)
      .where(sql`trim(${prompts.groupName}) = ${groupName}`);
    const row = {
      id: randomUUID(),
      title: parsed.title,
      description: parsed.description,
      content: parsed.content,
      groupName,
      extraInfo: parsed.extraInfo,
      injectionEnabled: parsed.injectionEnabled,
      injectionOrder: 0,
      sourceJson: parsed.source ? JSON.stringify(parsed.source) : null,
      sortOrder: next ?? 0,
      createdAt: now,
      updatedAt: now,
    };
    await db.insert(prompts).values(row);
    await this.syncInjectionOrder();
    events.emit(promptsUpdatedChannel, undefined);
    const [created] = await db.select().from(prompts).where(eq(prompts.id, row.id)).limit(1);
    return toPrompt(created);
  }

  async update(id: string, patch: PromptUpdateInput): Promise<Prompt | null> {
    const parsed = promptUpdateInputSchema.parse(patch);
    const normalizedGroupName = parsed.groupName?.trim();
    if (normalizedGroupName !== undefined) await this.ensureGroup(normalizedGroupName);
    if (Object.keys(parsed).length > 0) {
      const { source, groupName: _groupName, ...fields } = parsed;
      let sortOrder: number | undefined;
      let groupChanged = false;
      if (normalizedGroupName !== undefined) {
        const [current] = await db
          .select({ groupName: prompts.groupName })
          .from(prompts)
          .where(eq(prompts.id, id))
          .limit(1);
        groupChanged = Boolean(current && current.groupName.trim() !== normalizedGroupName);
        if (groupChanged) {
          const [{ next }] = await db
            .select({
              next: sql<number>`coalesce(max(${prompts.sortOrder}), -1) + 1`,
            })
            .from(prompts)
            .where(sql`trim(${prompts.groupName}) = ${normalizedGroupName}`);
          sortOrder = next ?? 0;
        }
      }
      const update = {
        ...fields,
        ...(normalizedGroupName !== undefined ? { groupName: normalizedGroupName } : {}),
        ...(sortOrder !== undefined ? { sortOrder } : {}),
        ...(source !== undefined ? { sourceJson: source ? JSON.stringify(source) : null } : {}),
      };
      await db.update(prompts).set(update).where(eq(prompts.id, id));
      if (groupChanged) await this.syncInjectionOrder();
    }
    events.emit(promptsUpdatedChannel, undefined);
    const [row] = await db.select().from(prompts).where(eq(prompts.id, id)).limit(1);
    return row ? toPrompt(row) : null;
  }

  async remove(id: string): Promise<void> {
    await db.delete(prompts).where(eq(prompts.id, id));
    await this.syncInjectionOrder();
    events.emit(promptsUpdatedChannel, undefined);
  }

  async setGroupInjectionEnabled(groupName: string, enabled: boolean): Promise<void> {
    const normalized = groupName.trim();
    await db
      .update(prompts)
      .set({ injectionEnabled: enabled })
      .where(sql`trim(${prompts.groupName}) = ${normalized}`);
    events.emit(promptsUpdatedChannel, undefined);
  }

  async reorderGroups(parentName: string | null, names: string[]): Promise<void> {
    const normalizedParentName = parentName ? promptGroupNameSchema.parse(parentName) : null;
    if (normalizedParentName) await this.requireGroup(normalizedParentName);
    const normalizedNames = names.map((name) => promptGroupNameSchema.parse(name));
    const uniqueNames = [...new Set(normalizedNames)];
    if (uniqueNames.length !== normalizedNames.length) {
      throw new Error('Prompt group order contains duplicates');
    }

    const existing = await db
      .select({ name: promptGroups.name })
      .from(promptGroups)
      .where(
        normalizedParentName === null
          ? isNull(promptGroups.parentName)
          : eq(promptGroups.parentName, normalizedParentName)
      );
    const existingNames = new Set(existing.map((row) => row.name));
    if (
      uniqueNames.length !== existingNames.size ||
      uniqueNames.some((name) => !existingNames.has(name))
    ) {
      throw new Error('Prompt group order must contain every sibling group');
    }
    db.transaction((tx) => {
      uniqueNames.forEach((name, index) => {
        tx.update(promptGroups).set({ sortOrder: index }).where(eq(promptGroups.name, name)).run();
      });
    });
    await this.syncInjectionOrder();
    events.emit(promptsUpdatedChannel, undefined);
  }

  async reorderPrompts(groupName: string, ids: string[]): Promise<void> {
    const normalizedGroupName = groupName.trim();
    if (normalizedGroupName) promptGroupNameSchema.parse(normalizedGroupName);
    const uniqueIds = [...new Set(ids)];
    if (uniqueIds.length !== ids.length) {
      throw new Error('Prompt order contains duplicates');
    }

    const existing = await db
      .select({ id: prompts.id })
      .from(prompts)
      .where(sql`trim(${prompts.groupName}) = ${normalizedGroupName}`);
    const existingIds = new Set(existing.map((row) => row.id));
    if (uniqueIds.length !== existingIds.size || uniqueIds.some((id) => !existingIds.has(id))) {
      throw new Error('Prompt order must contain every prompt in the group');
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
