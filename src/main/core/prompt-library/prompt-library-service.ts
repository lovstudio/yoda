import { randomUUID } from 'node:crypto';
import { asc, eq, ne, sql } from 'drizzle-orm';
import { promptsUpdatedChannel } from '@shared/events/appEvents';
import {
  promptCreateInputSchema,
  promptGroupNameSchema,
  promptSourceSchema,
  promptUpdateInputSchema,
  type Prompt,
  type PromptCreateInput,
  type PromptSource,
  type PromptUpdateInput,
} from '@shared/prompt-library';
import { appSettingsService } from '@main/core/settings/settings-service';
import { db } from '@main/db/client';
import { promptGroups, prompts } from '@main/db/schema';
import { events } from '@main/lib/events';

type PromptRow = typeof prompts.$inferSelect;

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
      await db
        .insert(promptGroups)
        .values(existingGroupNames)
        .onConflictDoNothing({ target: promptGroups.name });
    }
  }

  async list(): Promise<Prompt[]> {
    const rows = await db
      .select()
      .from(prompts)
      .orderBy(asc(prompts.sortOrder), asc(prompts.createdAt));
    return rows.map(toPrompt);
  }

  async listGroups(): Promise<string[]> {
    const rows = await db.select().from(promptGroups).orderBy(asc(promptGroups.name));
    return rows.map((row) => row.name);
  }

  async createGroup(name: string): Promise<string> {
    const parsed = promptGroupNameSchema.parse(name);
    await this.ensureGroup(parsed);
    events.emit(promptsUpdatedChannel, undefined);
    return parsed;
  }

  private async ensureGroup(name: string): Promise<void> {
    const normalized = name.trim();
    if (!normalized) return;
    await db
      .insert(promptGroups)
      .values({ name: promptGroupNameSchema.parse(normalized) })
      .onConflictDoNothing({ target: promptGroups.name });
  }

  async create(input: PromptCreateInput): Promise<Prompt> {
    const parsed = promptCreateInputSchema.parse(input);
    await this.ensureGroup(parsed.groupName);
    const now = new Date().toISOString();
    // Prepend new entries (smallest sortOrder sorts first).
    const [{ next }] = await db
      .select({ next: sql<number>`coalesce(min(${prompts.sortOrder}), 0) - 1` })
      .from(prompts);
    const [{ nextInjectionOrder }] = await db
      .select({
        nextInjectionOrder: sql<number>`coalesce(max(${prompts.injectionOrder}), -1) + 1`,
      })
      .from(prompts);
    const row = {
      id: randomUUID(),
      title: parsed.title,
      description: parsed.description,
      content: parsed.content,
      groupName: parsed.groupName,
      extraInfo: parsed.extraInfo,
      injectionEnabled: parsed.injectionEnabled,
      injectionOrder: nextInjectionOrder ?? 0,
      sourceJson: parsed.source ? JSON.stringify(parsed.source) : null,
      sortOrder: next ?? 0,
      createdAt: now,
      updatedAt: now,
    };
    await db.insert(prompts).values(row);
    events.emit(promptsUpdatedChannel, undefined);
    return toPrompt(row);
  }

  async update(id: string, patch: PromptUpdateInput): Promise<Prompt | null> {
    const parsed = promptUpdateInputSchema.parse(patch);
    if (parsed.groupName !== undefined) await this.ensureGroup(parsed.groupName);
    if (Object.keys(parsed).length > 0) {
      const { source, ...fields } = parsed;
      let injectionOrder: number | undefined;
      if (parsed.injectionEnabled === true) {
        const [current] = await db
          .select({ injectionEnabled: prompts.injectionEnabled })
          .from(prompts)
          .where(eq(prompts.id, id))
          .limit(1);
        if (current && !current.injectionEnabled) {
          const [{ next }] = await db
            .select({
              next: sql<number>`coalesce(max(${prompts.injectionOrder}), -1) + 1`,
            })
            .from(prompts)
            .where(eq(prompts.injectionEnabled, true));
          injectionOrder = next ?? 0;
        }
      }
      const update = {
        ...fields,
        ...(injectionOrder !== undefined ? { injectionOrder } : {}),
        ...(source !== undefined ? { sourceJson: source ? JSON.stringify(source) : null } : {}),
      };
      await db.update(prompts).set(update).where(eq(prompts.id, id));
    }
    events.emit(promptsUpdatedChannel, undefined);
    const [row] = await db.select().from(prompts).where(eq(prompts.id, id)).limit(1);
    return row ? toPrompt(row) : null;
  }

  async remove(id: string): Promise<void> {
    await db.delete(prompts).where(eq(prompts.id, id));
    events.emit(promptsUpdatedChannel, undefined);
  }

  async reorderInjection(ids: string[]): Promise<void> {
    const uniqueIds = [...new Set(ids)];
    if (uniqueIds.length !== ids.length)
      throw new Error('Prompt injection order contains duplicates');

    const enabled = await db
      .select({ id: prompts.id })
      .from(prompts)
      .where(eq(prompts.injectionEnabled, true));
    const enabledIds = new Set(enabled.map((row) => row.id));
    if (uniqueIds.length !== enabledIds.size || uniqueIds.some((id) => !enabledIds.has(id))) {
      throw new Error('Prompt injection order must contain every enabled prompt');
    }

    db.transaction((tx) => {
      uniqueIds.forEach((id, index) => {
        tx.update(prompts).set({ injectionOrder: index }).where(eq(prompts.id, id)).run();
      });
    });
    events.emit(promptsUpdatedChannel, undefined);
  }
}

export const promptLibraryService = new PromptLibraryService();
