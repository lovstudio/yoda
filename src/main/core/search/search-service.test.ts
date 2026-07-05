import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  sqlite: null as unknown,
}));

vi.mock('@main/db/client', () => ({
  get sqlite() {
    return state.sqlite;
  },
  db: {
    select: () => ({
      from: () => ({
        all: () => [],
      }),
    }),
  },
}));

vi.mock('@main/lib/logger', () => ({
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('SearchService conversations', () => {
  let sqlite: Database.Database;

  beforeEach(() => {
    vi.resetModules();
    sqlite = new Database(':memory:');
    state.sqlite = sqlite;
    createSchema(sqlite);
    seedConversations(sqlite);
  });

  afterEach(() => {
    sqlite.close();
    state.sqlite = null;
  });

  it('keeps archived conversations in recent session results', async () => {
    const { SearchService } = await import('./search-service');
    const service = new SearchService();

    const page = service.searchPaged({
      query: '',
      kind: 'conversation',
      offset: 0,
      limit: 10,
      context: {},
    });

    expect(page.items.map((item) => item.id)).toEqual([
      'active-conversation',
      'task-archived-conversation',
      'archived-conversation',
    ]);
    expect(page.items.find((item) => item.id === 'archived-conversation')).toMatchObject({
      archived: true,
      conversationArchived: true,
      taskArchived: false,
    });
    expect(page.items.find((item) => item.id === 'task-archived-conversation')).toMatchObject({
      archived: true,
      conversationArchived: false,
      taskArchived: true,
    });
  });

  it('marks a conversation archived in the search index instead of removing it', async () => {
    const { SearchService } = await import('./search-service');
    const { conversationEvents } = await import('../conversations/conversation-events');
    const service = new SearchService();
    service.initialize();

    sqlite
      .prepare(`UPDATE conversations SET archived_at = ? WHERE id = ?`)
      .run('2026-07-05T01:00:00.000Z', 'active-conversation');
    conversationEvents._emit(
      'conversation:archived',
      'active-conversation',
      'project-1',
      'active-task'
    );

    const indexed = sqlite
      .prepare(
        `SELECT item_id, archived FROM search_index WHERE item_type = 'conversation' AND item_id = ?`
      )
      .all('active-conversation');
    expect(indexed).toEqual([{ item_id: 'active-conversation', archived: '1' }]);

    expect(
      service.search({ query: 'Active', context: { taskId: 'active-task' } })[0]
    ).toMatchObject({
      id: 'active-conversation',
      archived: true,
      conversationArchived: true,
      taskArchived: false,
    });
  });
});

function createSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      path TEXT NOT NULL,
      archived_at TEXT,
      updated_at TEXT,
      is_internal INTEGER NOT NULL DEFAULT 0,
      workspace_id TEXT
    );

    CREATE TABLE tasks (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      project_id TEXT NOT NULL,
      archived_at TEXT,
      last_interacted_at TEXT,
      sidebar_workspace_id TEXT
    );

    CREATE TABLE conversations (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      project_id TEXT NOT NULL,
      task_id TEXT NOT NULL,
      archived_at TEXT,
      last_interacted_at TEXT
    );

    CREATE VIRTUAL TABLE search_index USING fts5(
      item_type,
      item_id    UNINDEXED,
      project_id UNINDEXED,
      task_id    UNINDEXED,
      archived   UNINDEXED,
      title,
      keywords,
      tokenize = 'trigram remove_diacritics 1'
    );
  `);
}

function seedConversations(db: Database.Database): void {
  db.exec(`
    INSERT INTO projects (id, name, path, updated_at, is_internal)
    VALUES ('project-1', 'Project', '/repo', '2026-07-05T00:00:00.000Z', 0);

    INSERT INTO tasks (id, name, project_id, archived_at, last_interacted_at)
    VALUES
      ('active-task', 'Active task', 'project-1', NULL, '2026-07-05T00:00:00.000Z'),
      ('archived-task', 'Archived task', 'project-1', '2026-07-05T00:10:00.000Z', '2026-07-05T00:10:00.000Z');

    INSERT INTO conversations (id, title, project_id, task_id, archived_at, last_interacted_at)
    VALUES
      ('active-conversation', 'Active session', 'project-1', 'active-task', NULL, '2026-07-05T00:30:00.000Z'),
      ('archived-conversation', 'Archived session', 'project-1', 'active-task', '2026-07-05T00:20:00.000Z', '2026-07-05T00:20:00.000Z'),
      ('task-archived-conversation', 'Task archived session', 'project-1', 'archived-task', NULL, '2026-07-05T00:25:00.000Z');
  `);
}
