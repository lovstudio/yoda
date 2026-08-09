import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '@main/db/schema';

const state = vi.hoisted(() => ({ db: null as unknown }));

vi.mock('@main/db/client', () => ({
  get db() {
    return state.db;
  },
}));

describe('getProjectSessionSources', () => {
  let sqlite: Database.Database;

  beforeEach(() => {
    vi.resetModules();
    sqlite = new Database(':memory:');
    sqlite.exec(`
      CREATE TABLE tasks (
        id TEXT PRIMARY KEY NOT NULL,
        project_id TEXT NOT NULL,
        name TEXT NOT NULL,
        archived_at TEXT
      );
      CREATE TABLE conversations (
        id TEXT PRIMARY KEY NOT NULL,
        project_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        title TEXT NOT NULL,
        title_source TEXT,
        provider TEXT,
        auth_provider TEXT,
        config TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        last_interacted_at TEXT,
        is_initial_conversation INTEGER,
        archived_at TEXT,
        forked_from_conversation_id TEXT,
        forked_from_prompt_index INTEGER
      );
      INSERT INTO tasks (id, project_id, name, archived_at) VALUES
        ('active-task', 'project-1', 'Active task', NULL),
        ('archived-task', 'project-1', 'Archived task', '2026-07-05T04:00:00.000Z'),
        ('other-task', 'project-2', 'Other task', NULL);
      INSERT INTO conversations (
        id, project_id, task_id, title, provider, last_interacted_at, is_initial_conversation
      ) VALUES
        ('active-session', 'project-1', 'active-task', 'Active session', 'codex', '2026-07-05T02:00:00.000Z', 1),
        ('archived-task-session', 'project-1', 'archived-task', 'Archived task session', 'claude', '2026-07-05T03:00:00.000Z', 1),
        ('corrupt-session', 'project-1', 'other-task', 'Corrupt relation', 'codex', '2026-07-05T05:00:00.000Z', 1),
        ('other-session', 'project-2', 'other-task', 'Other session', 'codex', '2026-07-05T04:00:00.000Z', 1);
    `);
    state.db = drizzle(sqlite, { schema });
  });

  afterEach(() => {
    sqlite.close();
    state.db = null;
  });

  it('returns project-scoped conversations with lightweight task metadata', async () => {
    const { getProjectSessionSources } = await import('./project-sessions');

    const sources = await getProjectSessionSources('project-1');

    expect(sources.map((source) => source.conversation.id)).toEqual([
      'archived-task-session',
      'active-session',
    ]);
    expect(sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          taskName: 'Active task',
          taskArchivedAt: null,
        }),
        expect.objectContaining({
          taskName: 'Archived task',
          taskArchivedAt: '2026-07-05T04:00:00.000Z',
        }),
      ])
    );
  });
});
