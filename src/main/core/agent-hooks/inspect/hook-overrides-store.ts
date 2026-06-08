import { eq } from 'drizzle-orm';
import { EMPTY_TASK_HOOK_OVERRIDES, type TaskHookOverrides } from '@shared/agent-hooks';
import { db } from '@main/db/client';
import { appSettings } from '@main/db/schema';

const STORAGE_KEY = 'hookOverrides';

type StoredOverrides = Record<string, TaskHookOverrides>;

async function readAll(): Promise<StoredOverrides> {
  const [row] = await db
    .select()
    .from(appSettings)
    .where(eq(appSettings.key, STORAGE_KEY))
    .execute();
  if (!row) return {};
  try {
    return JSON.parse(row.value) as StoredOverrides;
  } catch {
    return {};
  }
}

async function writeAll(overrides: StoredOverrides): Promise<void> {
  if (Object.keys(overrides).length === 0) {
    await db.delete(appSettings).where(eq(appSettings.key, STORAGE_KEY)).execute();
    return;
  }
  const value = JSON.stringify(overrides);
  await db
    .insert(appSettings)
    .values({ key: STORAGE_KEY, value })
    .onConflictDoUpdate({ target: appSettings.key, set: { value } })
    .execute();
}

function normalize(entry: Partial<TaskHookOverrides> | undefined): TaskHookOverrides {
  return {
    disabled: Array.isArray(entry?.disabled) ? [...new Set(entry.disabled)] : [],
    debug: entry?.debug === true,
  };
}

function isEmpty(entry: TaskHookOverrides): boolean {
  return entry.disabled.length === 0 && !entry.debug;
}

export const hookOverridesStore = {
  async get(taskId: string): Promise<TaskHookOverrides> {
    const all = await readAll();
    return normalize(all[taskId]) ?? EMPTY_TASK_HOOK_OVERRIDES;
  },

  async setHookEnabled(taskId: string, hookId: string, enabled: boolean): Promise<void> {
    const all = await readAll();
    const current = normalize(all[taskId]);
    const disabled = new Set(current.disabled);
    if (enabled) disabled.delete(hookId);
    else disabled.add(hookId);
    const next = normalize({ ...current, disabled: [...disabled] });
    if (isEmpty(next)) delete all[taskId];
    else all[taskId] = next;
    await writeAll(all);
  },

  async setDebug(taskId: string, debug: boolean): Promise<void> {
    const all = await readAll();
    const next = normalize({ ...normalize(all[taskId]), debug });
    if (isEmpty(next)) delete all[taskId];
    else all[taskId] = next;
    await writeAll(all);
  },
};
