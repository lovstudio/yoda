import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '@main/db/schema';
import {
  getTaskSessionLeafIdPages,
  TASK_SESSION_LEAF_PAGE_SIZE,
  type TaskSessionLeafIdPage,
} from './session-targets';

const state = vi.hoisted(() => ({
  db: null as unknown,
}));

vi.mock('@main/db/client', () => ({
  get db() {
    return state.db;
  },
}));

describe('task session target pagination', () => {
  let sqlite: Database.Database;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.exec(`
      CREATE TABLE conversations (
        id TEXT PRIMARY KEY NOT NULL,
        project_id TEXT NOT NULL,
        task_id TEXT NOT NULL
      );
      CREATE INDEX idx_conversations_task_id ON conversations(task_id);
      CREATE TABLE terminals (
        id TEXT PRIMARY KEY NOT NULL,
        project_id TEXT NOT NULL,
        task_id TEXT NOT NULL
      );
      CREATE INDEX idx_terminals_task_id ON terminals(task_id);
    `);
    state.db = drizzle(sqlite, { schema });
  });

  afterEach(() => {
    sqlite.close();
    state.db = null;
  });

  it('streams conversations and terminals in bounded keyset pages', async () => {
    const insertConversation = sqlite.prepare(
      'INSERT INTO conversations (id, project_id, task_id) VALUES (?, ?, ?)'
    );
    const insertTerminal = sqlite.prepare(
      'INSERT INTO terminals (id, project_id, task_id) VALUES (?, ?, ?)'
    );
    for (let index = 0; index < 5; index += 1) {
      insertConversation.run(`conversation-${index}`, 'project-1', 'task-1');
    }
    for (let index = 0; index < 7; index += 1) {
      insertTerminal.run(`terminal-${index}`, 'project-1', 'task-1');
    }
    insertTerminal.run('other-task-terminal', 'project-1', 'task-2');

    const pages: TaskSessionLeafIdPage[] = [];
    for await (const page of getTaskSessionLeafIdPages('project-1', 'task-1', {
      pageSize: 2,
    })) {
      pages.push(page);
    }

    expect(pages.every((page) => page.conversationIds.length + page.terminalIds.length <= 2)).toBe(
      true
    );
    expect(pages.flatMap((page) => page.conversationIds)).toEqual([
      'conversation-0',
      'conversation-1',
      'conversation-2',
      'conversation-3',
      'conversation-4',
    ]);
    expect(pages.flatMap((page) => page.terminalIds)).toEqual([
      'terminal-0',
      'terminal-1',
      'terminal-2',
      'terminal-3',
      'terminal-4',
      'terminal-5',
      'terminal-6',
    ]);
  });

  it('enumerates overflow cardinality without materializing it in one result', async () => {
    const insertTerminal = sqlite.prepare(
      'INSERT INTO terminals (id, project_id, task_id) VALUES (?, ?, ?)'
    );
    const total = TASK_SESSION_LEAF_PAGE_SIZE * 2 + 17;
    const insertAll = sqlite.transaction(() => {
      for (let index = 0; index < total; index += 1) {
        insertTerminal.run(
          `terminal-${String(index).padStart(4, '0')}`,
          'project-overflow',
          'task-overflow'
        );
      }
    });
    insertAll();

    const pageSizes: number[] = [];
    let enumerated = 0;
    for await (const page of getTaskSessionLeafIdPages('project-overflow', 'task-overflow')) {
      pageSizes.push(page.terminalIds.length);
      enumerated += page.terminalIds.length;
    }

    expect(enumerated).toBe(total);
    expect(pageSizes).toEqual([TASK_SESSION_LEAF_PAGE_SIZE, TASK_SESSION_LEAF_PAGE_SIZE, 17]);
  });

  it.each([
    ['conversations', 'idx_conversations_task_id'],
    ['terminals', 'idx_terminals_task_id'],
  ])('uses the task index rowid cursor without a temporary sort for %s', (table, indexName) => {
    const plan = sqlite
      .prepare(
        `EXPLAIN QUERY PLAN
         SELECT id, rowid AS cursor
         FROM ${table}
         WHERE task_id = ? AND rowid > ? AND project_id = ?
         ORDER BY rowid
         LIMIT ?`
      )
      .all('task-1', 0, 'project-1', TASK_SESSION_LEAF_PAGE_SIZE) as Array<{
      detail: string;
    }>;
    const details = plan.map((row) => row.detail).join('\n');

    expect(details).toContain(`USING INDEX ${indexName} (task_id=? AND rowid>?)`);
    expect(details).not.toContain('USE TEMP B-TREE FOR ORDER BY');
  });
});
