import { sql } from 'drizzle-orm';
import { db } from '@main/db/client';

export const TASK_SESSION_LEAF_PAGE_SIZE = 256;

export type TaskSessionLeafIdPage = {
  conversationIds: string[];
  terminalIds: string[];
};

type SessionLeafRow = {
  id: string;
  cursor: number;
};

function boundedPageSize(requested?: number): number {
  if (requested === undefined || !Number.isFinite(requested)) return TASK_SESSION_LEAF_PAGE_SIZE;
  return Math.max(1, Math.min(Math.floor(requested), TASK_SESSION_LEAF_PAGE_SIZE));
}

/**
 * Streams task-owned session leaves with keyset pagination. Cleanup must remain able to traverse
 * corrupt tasks with millions of terminal rows, so this path intentionally does not use the
 * renderer materialization cap from getTerminalsForTask.
 */
export async function* getTaskSessionLeafIdPages(
  projectId: string,
  taskId: string,
  options: { pageSize?: number } = {}
): AsyncGenerator<TaskSessionLeafIdPage> {
  const pageSize = boundedPageSize(options.pageSize);
  let conversationCursor = 0;

  while (true) {
    // SQLite rowid is the trailing key on every ordinary index entry. Paging
    // by it lets idx_conversations_task_id satisfy both the task predicate and
    // cursor without sorting the entire dirty task again for every page.
    const rows = db.all<SessionLeafRow>(sql`
      SELECT id, rowid AS cursor
      FROM conversations
      WHERE task_id = ${taskId}
        AND rowid > ${conversationCursor}
        AND project_id = ${projectId}
      ORDER BY rowid
      LIMIT ${pageSize}
    `);
    if (rows.length === 0) break;
    yield { conversationIds: rows.map((row) => row.id), terminalIds: [] };
    if (rows.length < pageSize) break;
    conversationCursor = rows[rows.length - 1].cursor;
  }

  let terminalCursor = 0;
  while (true) {
    const rows = db.all<SessionLeafRow>(sql`
      SELECT id, rowid AS cursor
      FROM terminals
      WHERE task_id = ${taskId}
        AND rowid > ${terminalCursor}
        AND project_id = ${projectId}
      ORDER BY rowid
      LIMIT ${pageSize}
    `);
    if (rows.length === 0) break;
    yield { conversationIds: [], terminalIds: rows.map((row) => row.id) };
    if (rows.length < pageSize) break;
    terminalCursor = rows[rows.length - 1].cursor;
  }
}
