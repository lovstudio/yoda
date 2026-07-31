import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import {
  ensureWorkspaceSchemaCompatibility,
  getBundledMigrationCount,
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
});
