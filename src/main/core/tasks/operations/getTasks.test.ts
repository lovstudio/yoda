import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '@main/db/schema';

const state = vi.hoisted(() => ({
  db: null as unknown,
}));

vi.mock('@main/db/client', () => ({
  get db() {
    return state.db;
  },
}));

vi.mock('./task-issues', () => ({
  getIssuesForTasks: vi.fn(async () => new Map()),
}));

describe('task hydration queries', () => {
  let sqlite: Database.Database;

  beforeEach(() => {
    vi.resetModules();
    sqlite = new Database(':memory:');
    createSchema(sqlite);
    seedTasks(sqlite);
    state.db = drizzle(sqlite, { schema });
  });

  afterEach(() => {
    sqlite.close();
    state.db = null;
  });

  it('keeps the all-tasks API while exposing bounded active, archived, point, and count reads', async () => {
    const { getActiveTasks, getArchivedTasks, getTask, getTaskCounts, getTasks, getTasksByIds } =
      await import('./getTasks');

    const [all, active, archived, task, affected, missing, counts] = await Promise.all([
      getTasks('project-1'),
      getActiveTasks('project-1'),
      getArchivedTasks('project-1'),
      getTask('project-1', 'task-915'),
      getTasksByIds('project-1', ['task-0', 'task-915', 'task-915']),
      getTask('project-2', 'task-915'),
      getTaskCounts(),
    ]);

    expect(all).toHaveLength(916);
    expect(active).toHaveLength(33);
    expect(active.every((item) => !item.archivedAt)).toBe(true);
    expect(archived).toHaveLength(883);
    expect(archived.every((item) => Boolean(item.archivedAt))).toBe(true);
    expect(task?.id).toBe('task-915');
    expect(affected.map((item) => item.id).sort()).toEqual(['task-0', 'task-915']);
    expect(missing).toBeNull();
    expect(counts).toEqual([{ projectId: 'project-1', active: 33, archived: 883 }]);
  });

  it('hydrates conversation counts only for the selected task slice', async () => {
    sqlite.exec(`
      INSERT INTO conversations (id, project_id, task_id, title, provider, archived_at)
      VALUES
        ('active-conversation', 'project-1', 'task-0', 'Active', 'codex', NULL),
        ('archived-conversation', 'project-1', 'task-0', 'Archived', 'codex', '2026-01-02');
    `);
    const { getTask } = await import('./getTasks');

    await expect(getTask('project-1', 'task-0')).resolves.toMatchObject({
      id: 'task-0',
      conversations: { codex: 1 },
    });
  });

  it('scopes lightweight counts to one project when requested', async () => {
    sqlite
      .prepare(
        `INSERT INTO tasks (id, project_id, name, status, archived_at)
         VALUES ('other-task', 'project-2', 'Other task', 'in_progress', NULL)`
      )
      .run();
    const { getTaskCounts } = await import('./getTasks');

    await expect(getTaskCounts('project-1')).resolves.toEqual([
      { projectId: 'project-1', active: 33, archived: 883 },
    ]);
  });
});

function createSchema(sqlite: Database.Database): void {
  sqlite.exec(`
    CREATE TABLE tasks (
      id TEXT PRIMARY KEY NOT NULL,
      project_id TEXT NOT NULL,
      name TEXT NOT NULL,
      status TEXT NOT NULL,
      source_branch TEXT,
      task_branch TEXT,
      linked_issue TEXT,
      archived_at TEXT,
      archive_note TEXT,
      archive_requested_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_interacted_at TEXT,
      status_changed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      diff_additions INTEGER,
      diff_deletions INTEGER,
      diff_captured_at TEXT,
      is_pinned INTEGER NOT NULL DEFAULT 0,
      is_favorite INTEGER NOT NULL DEFAULT 0,
      is_long_term INTEGER NOT NULL DEFAULT 0,
      needs_review INTEGER NOT NULL DEFAULT 0,
      is_user_named INTEGER NOT NULL DEFAULT 0,
      setup_status TEXT NOT NULL DEFAULT 'ready',
      setup_error TEXT,
      setup_data TEXT,
      workspace_provider TEXT,
      workspace_id TEXT,
      workspace_provider_data TEXT,
      sidebar_workspace_id TEXT,
      parent_task_id TEXT
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
  `);
}

function seedTasks(sqlite: Database.Database): void {
  const insert = sqlite.prepare(
    `INSERT INTO tasks (id, project_id, name, status, archived_at)
     VALUES (?, 'project-1', ?, 'in_progress', ?)`
  );
  const transaction = sqlite.transaction(() => {
    for (let index = 0; index < 916; index += 1) {
      insert.run(`task-${index}`, `Task ${index}`, index < 33 ? null : '2026-06-06T10:00:00.000Z');
    }
  });
  transaction();
}
