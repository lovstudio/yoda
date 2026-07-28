import { eq } from 'drizzle-orm';
import { db } from '@main/db/client';
import { appSettings } from '@main/db/schema';
import {
  parseStoredSessionStateRoots,
  SessionStateRootsCatalog,
  type SessionStateRootsStorage,
  type StoredSessionStateRoots,
} from './session-state-roots';

const STORAGE_KEY = 'localAgentSessionStateRoots';

class DatabaseSessionStateRootsStorage implements SessionStateRootsStorage {
  async read(): Promise<StoredSessionStateRoots> {
    const [row] = await db
      .select({ value: appSettings.value })
      .from(appSettings)
      .where(eq(appSettings.key, STORAGE_KEY))
      .limit(1);
    if (!row) return {};
    try {
      return parseStoredSessionStateRoots(JSON.parse(row.value));
    } catch {
      return {};
    }
  }

  async write(value: StoredSessionStateRoots): Promise<void> {
    const serialized = JSON.stringify(value);
    await db
      .insert(appSettings)
      .values({ key: STORAGE_KEY, value: serialized, updatedAt: Date.now() })
      .onConflictDoUpdate({
        target: appSettings.key,
        set: { value: serialized, updatedAt: Date.now() },
      });
  }
}

export const sessionStateRootsCatalog = new SessionStateRootsCatalog(
  new DatabaseSessionStateRootsStorage()
);
