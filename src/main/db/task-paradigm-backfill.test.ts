import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ensureTaskParadigmBackfill } from './initialize';

// `initialize` reaches the app-wide connection at import time, which resolves a
// userData path through Electron. The backfill takes its connection as an
// argument, so the shared one is never touched here.
vi.mock('./client', () => ({ sqlite: {} }));

/**
 * The backfill is the only place that rewrites paradigm data on tasks that
 * already exist, and it runs on the startup path — so both what it labels and
 * what it refuses to do to a second launch are load-bearing.
 */
describe('task paradigm backfill', () => {
  let sqlite: Database.Database;

  const kinds = () =>
    Object.fromEntries(
      sqlite
        .prepare('SELECT id, paradigm_kind FROM tasks')
        .all()
        .map((row) => [
          (row as { id: string }).id,
          (row as { paradigm_kind: string }).paradigm_kind,
        ])
    );

  const insertTask = (id: string, paradigmKind: string | null = null) =>
    sqlite.prepare('INSERT INTO tasks (id, paradigm_kind) VALUES (?, ?)').run(id, paradigmKind);

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.exec(`
      CREATE TABLE tasks (
        id TEXT PRIMARY KEY,
        paradigm_id TEXT,
        paradigm_kind TEXT,
        paradigm_params TEXT
      );
      CREATE TABLE team_rooms (id TEXT PRIMARY KEY, task_id TEXT NOT NULL);
      CREATE TABLE review_orchestrations (id TEXT PRIMARY KEY, task_id TEXT NOT NULL);
      CREATE TABLE kv (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);
  });

  afterEach(() => sqlite.close());

  it('recovers each kind from the side table the canvas used to reverse-look-up', () => {
    insertTask('task-team');
    insertTask('task-review');
    insertTask('task-plain');
    sqlite.prepare('INSERT INTO team_rooms (id, task_id) VALUES (?, ?)').run('room-1', 'task-team');
    sqlite
      .prepare('INSERT INTO review_orchestrations (id, task_id) VALUES (?, ?)')
      .run('orch-1', 'task-review');

    ensureTaskParadigmBackfill(sqlite);

    expect(kinds()).toEqual({
      'task-team': 'team',
      'task-review': 'review',
      'task-plain': 'single',
    });
    // Which *instance* ran is not recoverable — a room does not record the team it
    // came from — so the id stays null rather than being guessed.
    expect(
      sqlite.prepare('SELECT COUNT(*) AS n FROM tasks WHERE paradigm_id IS NOT NULL').get()
    ).toEqual({ n: 0 });
  });

  it('treats a task with both as team, since a team may run a review loop inside it', () => {
    insertTask('task-both');
    sqlite.prepare('INSERT INTO team_rooms (id, task_id) VALUES (?, ?)').run('room-1', 'task-both');
    sqlite
      .prepare('INSERT INTO review_orchestrations (id, task_id) VALUES (?, ?)')
      .run('orch-1', 'task-both');

    ensureTaskParadigmBackfill(sqlite);

    expect(kinds()['task-both']).toBe('team');
  });

  it('never relabels a task that already declares its paradigm', () => {
    insertTask('task-stamped', 'spec');
    sqlite
      .prepare('INSERT INTO team_rooms (id, task_id) VALUES (?, ?)')
      .run('room-1', 'task-stamped');

    ensureTaskParadigmBackfill(sqlite);

    expect(kinds()['task-stamped']).toBe('spec');
  });

  it('does not re-run, so a later relabel is not reverted', () => {
    insertTask('task-1');
    ensureTaskParadigmBackfill(sqlite);
    sqlite.prepare("UPDATE tasks SET paradigm_kind = 'team' WHERE id = 'task-1'").run();

    ensureTaskParadigmBackfill(sqlite);

    expect(kinds()['task-1']).toBe('team');
  });

  it('labels what it can when a side table is absent, rather than failing startup', () => {
    sqlite.exec('DROP TABLE review_orchestrations');
    insertTask('task-team');
    insertTask('task-plain');
    sqlite.prepare('INSERT INTO team_rooms (id, task_id) VALUES (?, ?)').run('room-1', 'task-team');

    expect(() => ensureTaskParadigmBackfill(sqlite)).not.toThrow();

    expect(kinds()).toEqual({ 'task-team': 'team', 'task-plain': 'single' });
  });
});
