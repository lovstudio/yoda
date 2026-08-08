import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import {
  ensureWorkspaceSchemaCompatibility,
  getBundledMigrationCount,
  getBundledMigrationRecords,
  runBundledMigrations,
} from './migrations';

/** Number of migrations that precede 0041_rainy_jackpot. */
const CONVERSATION_LINEAGE_PREVIOUS_MIGRATION_COUNT = 41;

function createMigrationTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE __drizzle_migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      hash TEXT NOT NULL,
      created_at NUMERIC
    )
  `);
}

function insertAppliedMigrationRows(db: Database.Database, count: number): void {
  const insert = db.prepare('INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)');

  for (let i = 0; i < count; i += 1) {
    insert.run(`hash-${i}`, i + 1);
  }
}

function createPartialWorkspaceSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE workspaces (
      id text PRIMARY KEY NOT NULL,
      name text NOT NULL,
      sort_order integer DEFAULT 0 NOT NULL,
      created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
      updated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL
    );

    CREATE TABLE projects (
      id text PRIMARY KEY NOT NULL,
      workspace_id text REFERENCES workspaces(id)
    );

    CREATE INDEX idx_projects_workspace_id ON projects (workspace_id);

    CREATE TABLE tasks (
      id text PRIMARY KEY NOT NULL
    );

    CREATE TABLE conversations (
      id text PRIMARY KEY NOT NULL
    );
  `);
}

function createPromptsSchemaWithoutGroups(db: Database.Database): void {
  db.exec(`
    CREATE TABLE prompts (
      id text PRIMARY KEY NOT NULL,
      title text NOT NULL,
      description text DEFAULT '' NOT NULL,
      content text NOT NULL,
      sort_order integer DEFAULT 0 NOT NULL,
      created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
      updated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL
    );

    INSERT INTO prompts (id, title, content)
    VALUES ('existing-prompt', 'Review', 'Review this change.');
  `);
}

function columnExists(db: Database.Database, tableName: string, columnName: string): boolean {
  const rows = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
  return rows.some((row) => row.name === columnName);
}

function indexExists(db: Database.Database, indexName: string): boolean {
  const row = db
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = ? LIMIT 1")
    .get(indexName);
  return row !== undefined;
}

function tableExists(db: Database.Database, tableName: string): boolean {
  return (
    db
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1")
      .get(tableName) !== undefined
  );
}

function countAppliedMigrations(db: Database.Database): number {
  const row = db.prepare('SELECT COUNT(*) AS count FROM __drizzle_migrations').get() as {
    count: number;
  };
  return row.count;
}

describe('runBundledMigrations', () => {
  it('adds nullable conversation lineage without rewriting existing sessions', () => {
    const db = new Database(':memory:');
    try {
      createMigrationTable(db);
      insertAppliedMigrationRows(db, CONVERSATION_LINEAGE_PREVIOUS_MIGRATION_COUNT);
      createPromptsSchemaWithoutGroups(db);
      db.exec(`
        CREATE TABLE conversations (id text PRIMARY KEY NOT NULL);
        INSERT INTO conversations (id) VALUES ('existing-conversation');
        CREATE TABLE tasks (id text PRIMARY KEY NOT NULL);
        INSERT INTO tasks (id) VALUES ('existing-task');
      `);

      runBundledMigrations(db);

      expect(columnExists(db, 'conversations', 'forked_from_conversation_id')).toBe(true);
      expect(columnExists(db, 'conversations', 'forked_from_prompt_index')).toBe(true);
      expect(indexExists(db, 'idx_conversations_forked_from_conversation_id')).toBe(true);
      expect(
        db
          .prepare(
            'SELECT forked_from_conversation_id, forked_from_prompt_index FROM conversations WHERE id = ?'
          )
          .get('existing-conversation')
      ).toEqual({ forked_from_conversation_id: null, forked_from_prompt_index: null });
      expect(columnExists(db, 'prompts', 'group_name')).toBe(true);
      expect(columnExists(db, 'prompts', 'version')).toBe(true);
      expect(tableExists(db, 'prompt_versions')).toBe(true);
      expect(
        db.prepare('SELECT group_name FROM prompts WHERE id = ?').get('existing-prompt')
      ).toEqual({ group_name: '' });
      expect(
        db.prepare('SELECT is_long_term FROM tasks WHERE id = ?').get('existing-task')
      ).toEqual({ is_long_term: 0 });
    } finally {
      db.close();
    }
  });

  it('repairs a partially-applied workspace migration instead of recreating workspaces', () => {
    const db = new Database(':memory:');
    try {
      createMigrationTable(db);
      insertAppliedMigrationRows(db, 21);
      createPartialWorkspaceSchema(db);

      expect(() => runBundledMigrations(db)).not.toThrow();

      expect(columnExists(db, 'tasks', 'sidebar_workspace_id')).toBe(true);
      expect(indexExists(db, 'idx_tasks_sidebar_workspace_id')).toBe(true);
      expect(countAppliedMigrations(db)).toBe(getBundledMigrationCount());
    } finally {
      db.close();
    }
  });

  it('repairs missing workspace sidebar columns when migration history already reached the journal', () => {
    const db = new Database(':memory:');
    try {
      createMigrationTable(db);
      insertAppliedMigrationRows(db, getBundledMigrationCount());
      createPartialWorkspaceSchema(db);

      runBundledMigrations(db);

      expect(columnExists(db, 'tasks', 'sidebar_workspace_id')).toBe(true);
      expect(indexExists(db, 'idx_tasks_sidebar_workspace_id')).toBe(true);
      expect(countAppliedMigrations(db)).toBe(getBundledMigrationCount());
    } finally {
      db.close();
    }
  });

  it('runs the squashed tail when the applied migration count exceeds the bundled journal', () => {
    // Simulates an upgrade from a release whose migration journal was longer
    // (squashed/renumbered since): the DB records more applied migrations than
    // the bundled journal contains, and the shared prefix hashes match while
    // the tail (0045 onward) was never applied.
    const db = new Database(':memory:');
    try {
      createMigrationTable(db);

      const records = getBundledMigrationRecords();
      expect(records.length).toBe(getBundledMigrationCount());

      const shared = records.filter((record) => record.idx < 45);
      const insert = db.prepare(
        'INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)'
      );
      shared.forEach((record) => insert.run(record.hash, record.when));
      for (let i = 0; i < 20; i += 1) {
        insert.run(`legacy-extra-${i}`, 5000 + i);
      }
      expect(countAppliedMigrations(db)).toBeGreaterThan(getBundledMigrationCount());

      db.exec(`
        CREATE TABLE prompt_groups (
          name text PRIMARY KEY NOT NULL,
          created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL
        );
        CREATE TABLE prompts (id text PRIMARY KEY NOT NULL);
        CREATE TABLE tasks (id text PRIMARY KEY NOT NULL);
        CREATE TABLE projects (id text PRIMARY KEY NOT NULL);
      `);

      expect(() => runBundledMigrations(db)).not.toThrow();

      expect(columnExists(db, 'prompt_groups', 'sort_order')).toBe(true);
      expect(columnExists(db, 'prompt_groups', 'parent_name')).toBe(true);
      expect(columnExists(db, 'prompts', 'version')).toBe(true);
      expect(tableExists(db, 'prompt_versions')).toBe(true);
      expect(columnExists(db, 'tasks', 'is_long_term')).toBe(true);
      expect(columnExists(db, 'workspace_terminals', 'id')).toBe(true);
      expect(indexExists(db, 'idx_workspace_terminals_project_scope')).toBe(true);
      expect(countAppliedMigrations(db)).toBe(
        shared.length + 20 + (records.length - shared.length)
      );
    } finally {
      db.close();
    }
  });

  it('creates missing workspace grouping schema idempotently', () => {
    const db = new Database(':memory:');
    try {
      db.exec(`
        CREATE TABLE projects (id text PRIMARY KEY NOT NULL);
        CREATE TABLE tasks (id text PRIMARY KEY NOT NULL);
      `);

      ensureWorkspaceSchemaCompatibility(db);
      ensureWorkspaceSchemaCompatibility(db);

      expect(columnExists(db, 'projects', 'workspace_id')).toBe(true);
      expect(columnExists(db, 'tasks', 'sidebar_workspace_id')).toBe(true);
      expect(indexExists(db, 'idx_projects_workspace_id')).toBe(true);
      expect(indexExists(db, 'idx_tasks_sidebar_workspace_id')).toBe(true);
    } finally {
      db.close();
    }
  });

  it('repairs missing team communication settings after a journal-count upgrade', () => {
    const db = new Database(':memory:');
    try {
      createMigrationTable(db);
      insertAppliedMigrationRows(db, getBundledMigrationCount());
      db.exec(`
        CREATE TABLE agent_teams (id text PRIMARY KEY NOT NULL);
        CREATE TABLE team_rooms (id text PRIMARY KEY NOT NULL);
      `);

      runBundledMigrations(db);

      expect(columnExists(db, 'agent_teams', 'communication')).toBe(true);
      expect(columnExists(db, 'team_rooms', 'communication')).toBe(true);
    } finally {
      db.close();
    }
  });
});
