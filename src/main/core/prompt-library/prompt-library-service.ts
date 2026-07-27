import { randomUUID } from 'node:crypto';
import { asc, eq, sql } from 'drizzle-orm';
import { promptsUpdatedChannel } from '@shared/events/appEvents';
import {
  promptCreateInputSchema,
  promptUpdateInputSchema,
  type Prompt,
  type PromptCreateInput,
  type PromptUpdateInput,
} from '@shared/prompt-library';
import { db } from '@main/db/client';
import { prompts } from '@main/db/schema';
import { events } from '@main/lib/events';

type PromptRow = typeof prompts.$inferSelect;

function toPrompt(row: PromptRow): Prompt {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    content: row.content,
    groupName: row.groupName,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Saved prompts live in the `prompts` table. This service is the single source
 * of truth; the renderer reaches it only via RPC.
 */
export class PromptLibraryService {
  async list(): Promise<Prompt[]> {
    const rows = await db
      .select()
      .from(prompts)
      .orderBy(asc(prompts.sortOrder), asc(prompts.createdAt));
    return rows.map(toPrompt);
  }

  async create(input: PromptCreateInput): Promise<Prompt> {
    const parsed = promptCreateInputSchema.parse(input);
    const now = new Date().toISOString();
    // Prepend new entries (smallest sortOrder sorts first).
    const [{ next }] = await db
      .select({ next: sql<number>`coalesce(min(${prompts.sortOrder}), 0) - 1` })
      .from(prompts);
    const row = {
      id: randomUUID(),
      title: parsed.title,
      description: parsed.description,
      content: parsed.content,
      groupName: parsed.groupName,
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
    if (Object.keys(parsed).length > 0) {
      await db.update(prompts).set(parsed).where(eq(prompts.id, id));
    }
    events.emit(promptsUpdatedChannel, undefined);
    const [row] = await db.select().from(prompts).where(eq(prompts.id, id)).limit(1);
    return row ? toPrompt(row) : null;
  }

  async remove(id: string): Promise<void> {
    await db.delete(prompts).where(eq(prompts.id, id));
    events.emit(promptsUpdatedChannel, undefined);
  }
}

export const promptLibraryService = new PromptLibraryService();
