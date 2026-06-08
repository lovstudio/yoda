import { createHash } from 'node:crypto';
import type BetterSqlite3 from 'better-sqlite3';
import journal from '@root/drizzle/meta/_journal.json';

// Vite bundles all migration SQL files at build time; no runtime path resolution needed.
// Each value is the raw SQL string content of the file.
const sqlFiles = import.meta.glob('@root/drizzle/*.sql', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

type JournalEntry = { idx: number; when: number; tag: string; breakpoints: boolean };

const migrationEntries = (journal as { entries: JournalEntry[] }).entries;

function quoteIdentifier(identifier: string): string {
  return `"${identifier.split('"').join('""')}"`;
}

function ensureMigrationTable(connection: BetterSqlite3.Database): void {
  connection.exec(`
    CREATE TABLE IF NOT EXISTS __drizzle_migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      hash TEXT NOT NULL,
      created_at NUMERIC
    )
  `);
}

function getAppliedMigrationCount(connection: BetterSqlite3.Database): number {
  const row = connection.prepare('SELECT COUNT(*) AS count FROM __drizzle_migrations').get() as
    | { count: number }
    | undefined;
  return row?.count ?? 0;
}

function tableExists(connection: BetterSqlite3.Database, tableName: string): boolean {
  const row = connection
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1")
    .get(tableName);
  return row !== undefined;
}

function columnExists(
  connection: BetterSqlite3.Database,
  tableName: string,
  columnName: string
): boolean {
  const rows = connection
    .prepare(`PRAGMA table_info(${quoteIdentifier(tableName)})`)
    .all() as Array<{ name: string }>;
  return rows.some((row) => row.name === columnName);
}

function indexExists(connection: BetterSqlite3.Database, indexName: string): boolean {
  const row = connection
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = ? LIMIT 1")
    .get(indexName);
  return row !== undefined;
}

function workspaceSchemaPartiallyExists(connection: BetterSqlite3.Database): boolean {
  return (
    tableExists(connection, 'workspaces') ||
    (tableExists(connection, 'projects') && columnExists(connection, 'projects', 'workspace_id')) ||
    (tableExists(connection, 'tasks') && columnExists(connection, 'tasks', 'sidebar_workspace_id'))
  );
}

export function ensureWorkspaceSchemaCompatibility(connection: BetterSqlite3.Database): void {
  if (!tableExists(connection, 'workspaces')) {
    connection.exec(`
      CREATE TABLE workspaces (
        id text PRIMARY KEY NOT NULL,
        name text NOT NULL,
        sort_order integer DEFAULT 0 NOT NULL,
        created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
        updated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL
      )
    `);
  }

  if (
    tableExists(connection, 'projects') &&
    !columnExists(connection, 'projects', 'workspace_id')
  ) {
    connection.exec('ALTER TABLE projects ADD workspace_id text REFERENCES workspaces(id)');
  }

  if (
    tableExists(connection, 'projects') &&
    columnExists(connection, 'projects', 'workspace_id') &&
    !indexExists(connection, 'idx_projects_workspace_id')
  ) {
    connection.exec('CREATE INDEX idx_projects_workspace_id ON projects (workspace_id)');
  }

  if (
    tableExists(connection, 'tasks') &&
    !columnExists(connection, 'tasks', 'sidebar_workspace_id')
  ) {
    connection.exec('ALTER TABLE tasks ADD sidebar_workspace_id text REFERENCES workspaces(id)');
  }

  if (
    tableExists(connection, 'tasks') &&
    columnExists(connection, 'tasks', 'sidebar_workspace_id') &&
    !indexExists(connection, 'idx_tasks_sidebar_workspace_id')
  ) {
    connection.exec('CREATE INDEX idx_tasks_sidebar_workspace_id ON tasks (sidebar_workspace_id)');
  }
}

export function getBundledMigrationCount(): number {
  return migrationEntries.length;
}

export function runBundledMigrations(connection: BetterSqlite3.Database): void {
  ensureMigrationTable(connection);

  const appliedMigrationCount = getAppliedMigrationCount(connection);

  connection.transaction(() => {
    for (const entry of migrationEntries) {
      if (entry.idx < appliedMigrationCount) continue;

      const sqlKey = Object.keys(sqlFiles).find((k) => k.includes(entry.tag));
      if (!sqlKey) throw new Error(`Missing bundled SQL for migration: ${entry.tag}`);

      const sql = sqlFiles[sqlKey];
      const hash = createHash('sha256').update(sql).digest('hex');

      if (entry.tag === '0021_polite_unus' && workspaceSchemaPartiallyExists(connection)) {
        ensureWorkspaceSchemaCompatibility(connection);
      } else {
        for (const stmt of sql.split('--> statement-breakpoint')) {
          const trimmed = stmt.trim();
          if (trimmed) connection.exec(trimmed);
        }
      }

      connection
        .prepare('INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)')
        .run(hash, entry.when);
    }
  })();

  ensureWorkspaceSchemaCompatibility(connection);
}
