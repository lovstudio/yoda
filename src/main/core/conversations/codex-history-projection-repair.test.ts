import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import {
  repairCodexDuplicatedSessionMetaBoundary,
  repairCodexThreadHistoryProjection,
} from './codex-history-projection-repair';

const THREAD_ID = '019feaee-f733-7f73-b1bf-7a1162d8af79';

describe('repairCodexThreadHistoryProjection', () => {
  let directory: string | undefined;

  afterEach(() => {
    if (directory) rmSync(directory, { recursive: true, force: true });
    directory = undefined;
  });

  it('rewinds the projection cursor across a duplicated settings event', () => {
    const fixture = createFixture([
      rolloutLine(0, 'session_meta'),
      rolloutLine(1, 'task_started'),
      rolloutLine(2, 'token_count'),
      rolloutLine(2, 'thread_settings_applied'),
      rolloutLine(3, 'task_started'),
    ]);
    const before = readFileSync(fixture.rolloutPath);

    expect(
      repairCodexThreadHistoryProjection({ statePath: fixture.statePath, threadId: THREAD_ID })
    ).toEqual({
      status: 'repaired',
      byteOffset: fixture.checkpointOffset,
      fromOrdinal: 3,
      toOrdinal: 2,
    });
    expect(readCheckpointOrdinal(fixture.historyPath)).toBe(2);
    expect(readFileSync(fixture.rolloutPath)).toEqual(before);
  });

  it('is idempotent after the projection cursor has been repaired', () => {
    const fixture = createFixture([
      rolloutLine(0, 'session_meta'),
      rolloutLine(1, 'task_started'),
      rolloutLine(2, 'token_count'),
      rolloutLine(2, 'thread_settings_applied'),
    ]);

    repairCodexThreadHistoryProjection({ statePath: fixture.statePath, threadId: THREAD_ID });

    expect(
      repairCodexThreadHistoryProjection({ statePath: fixture.statePath, threadId: THREAD_ID })
    ).toEqual({ status: 'unchanged', reason: 'checkpoint-current' });
    expect(readCheckpointOrdinal(fixture.historyPath)).toBe(2);
  });

  it('leaves a healthy checkpoint unchanged', () => {
    const fixture = createFixture([
      rolloutLine(0, 'session_meta'),
      rolloutLine(1, 'task_started'),
      rolloutLine(2, 'token_count'),
      rolloutLine(3, 'thread_settings_applied'),
    ]);

    expect(
      repairCodexThreadHistoryProjection({ statePath: fixture.statePath, threadId: THREAD_ID })
    ).toEqual({ status: 'unchanged', reason: 'checkpoint-current' });
    expect(readCheckpointOrdinal(fixture.historyPath)).toBe(3);
  });

  it('does not reinterpret transcript-bearing duplicate events', () => {
    const fixture = createFixture([
      rolloutLine(0, 'session_meta'),
      rolloutLine(1, 'task_started'),
      rolloutLine(2, 'token_count'),
      rolloutLine(2, 'item_completed'),
    ]);

    expect(
      repairCodexThreadHistoryProjection({ statePath: fixture.statePath, threadId: THREAD_ID })
    ).toEqual({ status: 'unchanged', reason: 'unsupported-regression' });
    expect(readCheckpointOrdinal(fixture.historyPath)).toBe(3);
  });

  it('falls back to full replay for the duplicate SessionMeta boundary written by older Yoda', () => {
    directory = mkdtempSync(join(tmpdir(), 'yoda-codex-duplicate-meta-'));
    const rolloutPath = join(directory, 'rollout.jsonl');
    const firstMeta = {
      ordinal: 0,
      timestamp: '2026-08-13T04:01:42.194Z',
      type: 'session_meta',
      payload: {
        id: THREAD_ID,
        timestamp: '2026-08-13T04:00:58.818Z',
        model_provider: 'openai',
        history_mode: 'paginated',
        session_id: THREAD_ID,
      },
    };
    const lines = [
      JSON.stringify(firstMeta),
      rolloutLine(1, 'task_started'),
      rolloutLine(44, 'turn_aborted'),
      JSON.stringify({ ...firstMeta, timestamp: '2026-08-13T04:03:06.579Z' }),
      rolloutLine(1, 'thread_settings_applied'),
    ];
    writeFileSync(rolloutPath, `${lines.join('\n')}\n`);
    const originalBytes = readFileSync(rolloutPath).byteLength;
    const checkpointOffset = Buffer.byteLength(`${lines.slice(0, 3).join('\n')}\n`);

    const statePath = join(directory, 'state_5.sqlite');
    const db = new Database(statePath);
    db.exec('CREATE TABLE threads (id TEXT PRIMARY KEY, history_mode TEXT, rollout_path TEXT)');
    db.prepare('INSERT INTO threads (id, history_mode, rollout_path) VALUES (?, ?, ?)').run(
      THREAD_ID,
      'paginated',
      rolloutPath
    );
    db.close();

    const historyDb = new Database(join(directory, 'thread_history_1.sqlite'));
    historyDb.exec(`
      CREATE TABLE thread_history_projection_state (
        thread_id TEXT PRIMARY KEY,
        next_rollout_byte_offset INTEGER NOT NULL,
        next_rollout_ordinal INTEGER NOT NULL
      )
    `);
    historyDb
      .prepare('INSERT INTO thread_history_projection_state VALUES (?, ?, ?)')
      .run(THREAD_ID, checkpointOffset, 45);
    historyDb.close();

    expect(repairCodexDuplicatedSessionMetaBoundary({ statePath, threadId: THREAD_ID })).toEqual({
      status: 'repaired',
      fromHistoryMode: 'paginated',
      toHistoryMode: 'legacy',
    });
    expect(readFileSync(rolloutPath).byteLength).toBe(originalBytes);
    const repairedFirstMeta = JSON.parse(
      readFileSync(rolloutPath, 'utf8').split('\n')[0] ?? '{}'
    ) as {
      payload?: { history_mode?: string };
    };
    expect(repairedFirstMeta.payload?.history_mode).toBe('legacy');
    const repairedDb = new Database(statePath, { readonly: true });
    expect(
      repairedDb.prepare('SELECT history_mode FROM threads WHERE id = ?').get(THREAD_ID)
    ).toEqual({ history_mode: 'legacy' });
    repairedDb.close();

    const interruptedDb = new Database(statePath);
    interruptedDb
      .prepare("UPDATE threads SET history_mode = 'paginated' WHERE id = ?")
      .run(THREAD_ID);
    interruptedDb.close();
    expect(repairCodexDuplicatedSessionMetaBoundary({ statePath, threadId: THREAD_ID })).toEqual({
      status: 'repaired',
      fromHistoryMode: 'paginated',
      toHistoryMode: 'legacy',
    });

    expect(repairCodexDuplicatedSessionMetaBoundary({ statePath, threadId: THREAD_ID })).toEqual({
      status: 'unchanged',
      reason: 'not-paginated',
    });
  });

  function createFixture(lines: string[]): {
    statePath: string;
    historyPath: string;
    rolloutPath: string;
    checkpointOffset: number;
  } {
    directory = mkdtempSync(join(tmpdir(), 'yoda-codex-projection-'));
    const sessionDirectory = join(directory, 'sessions');
    mkdirSync(sessionDirectory);
    const rolloutPath = join(sessionDirectory, 'rollout.jsonl');
    const checkpointOffset = Buffer.byteLength(`${lines.slice(0, 3).join('\n')}\n`);
    writeFileSync(rolloutPath, `${lines.join('\n')}\n`);

    const statePath = join(directory, 'state_5.sqlite');
    const stateDb = new Database(statePath);
    stateDb.exec(
      'CREATE TABLE threads (id TEXT PRIMARY KEY, history_mode TEXT, rollout_path TEXT)'
    );
    stateDb
      .prepare('INSERT INTO threads (id, history_mode, rollout_path) VALUES (?, ?, ?)')
      .run(THREAD_ID, 'paginated', rolloutPath);
    stateDb.close();

    const historyPath = join(directory, 'thread_history_1.sqlite');
    const historyDb = new Database(historyPath);
    historyDb.exec(`
      CREATE TABLE thread_history_projection_state (
        thread_id TEXT PRIMARY KEY,
        next_rollout_byte_offset INTEGER NOT NULL,
        next_rollout_ordinal INTEGER NOT NULL
      )
    `);
    historyDb
      .prepare(
        `
          INSERT INTO thread_history_projection_state (
            thread_id,
            next_rollout_byte_offset,
            next_rollout_ordinal
          ) VALUES (?, ?, ?)
        `
      )
      .run(THREAD_ID, checkpointOffset, 3);
    historyDb.close();

    return { statePath, historyPath, rolloutPath, checkpointOffset };
  }
});

function rolloutLine(ordinal: number, payloadType: string): string {
  return JSON.stringify({
    timestamp: '2026-08-10T09:54:39.487Z',
    type: payloadType === 'session_meta' ? 'session_meta' : 'event_msg',
    payload: { type: payloadType },
    ordinal,
  });
}

function readCheckpointOrdinal(historyPath: string): number {
  const db = new Database(historyPath, { readonly: true });
  try {
    const row = db
      .prepare('SELECT next_rollout_ordinal AS ordinal FROM thread_history_projection_state')
      .get() as { ordinal: number };
    return row.ordinal;
  } finally {
    db.close();
  }
}
