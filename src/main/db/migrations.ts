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

type BundledMigrationRecord = { idx: number; tag: string; when: number; hash: string };

/**
 * Resolve every bundled migration to its SQL content hash. The journal is
 * squashed/renumbered between releases, so positions (`idx`) are not stable
 * across versions — the content hash recorded in `__drizzle_migrations` is the
 * only identity that survives a renumber.
 */
function resolveBundledMigrationRecords(): BundledMigrationRecord[] {
  return migrationEntries.map((entry) => {
    const sqlKey = Object.keys(sqlFiles).find((k) => k.includes(entry.tag));
    if (!sqlKey) throw new Error(`Missing bundled SQL for migration: ${entry.tag}`);
    return {
      idx: entry.idx,
      tag: entry.tag,
      when: entry.when,
      hash: createHash('sha256').update(sqlFiles[sqlKey]).digest('hex'),
    };
  });
}

const bundledMigrationRecords = resolveBundledMigrationRecords();

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

function getAppliedMigrationHashes(connection: BetterSqlite3.Database): Set<string> {
  const rows = connection.prepare('SELECT hash FROM __drizzle_migrations').all() as Array<{
    hash: string;
  }>;
  return new Set(rows.map((row) => row.hash));
}

/** @internal exposed for tests */
export function getBundledMigrationRecords(): BundledMigrationRecord[] {
  return bundledMigrationRecords;
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

  // When the applied migration count exceeds the bundled journal, the journal
  // was squashed/renumbered between releases: positions (`idx`) no longer line
  // up, and skipping by count would silently skip every bundled migration,
  // leaving the schema stale (e.g. "no such column" at runtime). In that case
  // fall back to content hashes and run only migrations whose SQL was never
  // applied before.
  const historyRenumbered = appliedMigrationCount > bundledMigrationRecords.length;
  const appliedHashes = historyRenumbered ? getAppliedMigrationHashes(connection) : null;

  connection.transaction(() => {
    for (const record of bundledMigrationRecords) {
      if (record.idx < appliedMigrationCount && !historyRenumbered) continue;
      if (historyRenumbered && appliedHashes?.has(record.hash)) continue;

      if (record.tag === '0021_polite_unus' && workspaceSchemaPartiallyExists(connection)) {
        ensureWorkspaceSchemaCompatibility(connection);
      } else {
        const sqlKey = Object.keys(sqlFiles).find((k) => k.includes(record.tag));
        if (!sqlKey) throw new Error(`Missing bundled SQL for migration: ${record.tag}`);
        const sql = sqlFiles[sqlKey];
        for (const stmt of sql.split('--> statement-breakpoint')) {
          const trimmed = stmt.trim();
          if (trimmed) connection.exec(trimmed);
        }
      }

      connection
        .prepare('INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)')
        .run(record.hash, record.when);
    }
  })();

  ensureWorkspaceSchemaCompatibility(connection);
}
