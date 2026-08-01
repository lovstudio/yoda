import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makePtySessionId } from '@shared/ptySessionId';
import { ptySessionRegistry } from '@main/core/pty/pty-session-registry';
import type { AppDb } from '@main/db/client';
import * as schema from '@main/db/schema';
import type * as ProjectUtilsModule from '../projects/utils';
import { createTerminal, TERMINAL_ROLLBACK_KILL_TIMEOUT_MS } from './createTerminal';
import { MAX_PERSISTED_TERMINALS_PER_TASK } from './getTerminalsForTask';

const state = vi.hoisted(() => ({
  db: null as unknown as AppDb,
}));

const mocks = vi.hoisted(() => ({
  captureTelemetry: vi.fn(),
  resolveTask: vi.fn(),
  spawnTerminal: vi.fn(),
  killTerminal: vi.fn(),
}));

vi.mock('@main/db/client', () => ({
  get db() {
    return state.db;
  },
}));

vi.mock('@main/lib/telemetry', () => ({
  telemetryService: { capture: mocks.captureTelemetry },
}));

vi.mock('../projects/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof ProjectUtilsModule>();
  return { ...actual, resolveTask: mocks.resolveTask };
});

const params = {
  id: 'terminal-1',
  projectId: 'project-1',
  taskId: 'task-1',
  name: 'Terminal',
};

describe('createTerminal persistence and registration guards', () => {
  let sqlite: Database.Database;
  const sessionIds = new Set<string>();

  beforeEach(() => {
    vi.clearAllMocks();
    sqlite = new Database(':memory:');
    sqlite.exec(`
      CREATE TABLE tasks (
        id TEXT PRIMARY KEY NOT NULL,
        project_id TEXT NOT NULL,
        archived_at TEXT,
        archive_requested_at TEXT
      );
      CREATE TABLE terminals (
        id TEXT PRIMARY KEY NOT NULL,
        project_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        ssh INTEGER NOT NULL DEFAULT 0,
        name TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX idx_terminals_task_id ON terminals(task_id);
    `);
    state.db = drizzle(sqlite, { schema });
    mocks.resolveTask.mockReturnValue({
      terminals: { spawnTerminal: mocks.spawnTerminal, killTerminal: mocks.killTerminal },
    });
    mocks.spawnTerminal.mockResolvedValue(undefined);
    mocks.killTerminal.mockResolvedValue(undefined);
    seedTask(params.projectId, params.taskId);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    for (const sessionId of sessionIds) ptySessionRegistry.unregister(sessionId);
    sessionIds.clear();
    sqlite.close();
  });

  function seedTask(
    projectId: string,
    taskId: string,
    options: { archivedAt?: string; archiveRequestedAt?: string } = {}
  ): void {
    sqlite
      .prepare(
        `INSERT INTO tasks (id, project_id, archived_at, archive_requested_at) VALUES (?, ?, ?, ?)`
      )
      .run(taskId, projectId, options.archivedAt ?? null, options.archiveRequestedAt ?? null);
  }

  function trackSession(projectId: string, taskId: string, terminalId: string): void {
    sessionIds.add(makePtySessionId(projectId, taskId, terminalId));
  }

  function terminalCount(taskId: string): number {
    return (
      sqlite.prepare('SELECT COUNT(*) AS value FROM terminals WHERE task_id = ?').get(taskId) as {
        value: number;
      }
    ).value;
  }

  it('persists and starts an ordinary terminal once', async () => {
    trackSession(params.projectId, params.taskId, params.id);

    await expect(createTerminal(params)).resolves.toMatchObject(params);

    expect(terminalCount(params.taskId)).toBe(1);
    expect(mocks.spawnTerminal).toHaveBeenCalledTimes(1);
  });

  it('rejects a missing task before persisting anything', async () => {
    mocks.resolveTask.mockReturnValueOnce(undefined);

    await expect(createTerminal(params)).rejects.toThrow('Task not found');

    expect(terminalCount(params.taskId)).toBe(0);
    expect(mocks.spawnTerminal).not.toHaveBeenCalled();
  });

  it.each([
    { column: 'archived_at', value: '2026-07-31T09:41:50.000Z' },
    { column: 'archive_requested_at', value: '2026-08-01T00:00:00.000Z' },
  ])(
    'rejects task archive state $column inside the insert transaction',
    async ({ column, value }) => {
      sqlite.prepare(`UPDATE tasks SET ${column} = ? WHERE id = ?`).run(value, params.taskId);

      await expect(createTerminal(params)).rejects.toThrow('missing or archived task');

      expect(terminalCount(params.taskId)).toBe(0);
      expect(mocks.spawnTerminal).not.toHaveBeenCalled();
    }
  );

  it('shares concurrent same-intent creates without cancelling the valid registration', async () => {
    let finishSpawn!: () => void;
    mocks.spawnTerminal.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        finishSpawn = resolve;
      })
    );
    trackSession(params.projectId, params.taskId, params.id);

    const first = createTerminal(params);
    const duplicate = createTerminal({ ...params, initialSize: { cols: 80, rows: 24 } });

    expect(duplicate).toBe(first);
    expect(terminalCount(params.taskId)).toBe(1);
    expect(mocks.spawnTerminal).toHaveBeenCalledTimes(1);
    finishSpawn();
    await expect(Promise.all([first, duplicate])).resolves.toHaveLength(2);
  });

  it('rejects conflicting params for the same in-flight terminal ID', async () => {
    let finishSpawn!: () => void;
    mocks.spawnTerminal.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        finishSpawn = resolve;
      })
    );
    trackSession(params.projectId, params.taskId, params.id);

    const first = createTerminal(params);
    await expect(createTerminal({ ...params, name: 'Conflicting' })).rejects.toThrow(
      'conflicting terminal creation'
    );

    expect(terminalCount(params.taskId)).toBe(1);
    expect(mocks.spawnTerminal).toHaveBeenCalledTimes(1);
    finishSpawn();
    await expect(first).resolves.toMatchObject(params);
  });

  it('atomically prevents concurrent creates from crossing the persisted cap', async () => {
    const projectId = 'project-cap';
    const taskId = 'task-cap';
    seedTask(projectId, taskId);
    const insert = sqlite.prepare(
      `INSERT INTO terminals (id, project_id, task_id, name) VALUES (?, ?, ?, ?)`
    );
    for (let index = 0; index < MAX_PERSISTED_TERMINALS_PER_TASK - 1; index += 1) {
      insert.run(`existing-${index}`, projectId, taskId, `Existing ${index}`);
    }
    trackSession(projectId, taskId, 'terminal-cap-a');
    trackSession(projectId, taskId, 'terminal-cap-b');

    const results = await Promise.allSettled([
      createTerminal({ id: 'terminal-cap-a', projectId, taskId, name: 'A' }),
      createTerminal({ id: 'terminal-cap-b', projectId, taskId, name: 'B' }),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(terminalCount(taskId)).toBe(MAX_PERSISTED_TERMINALS_PER_TASK);
    expect(mocks.spawnTerminal).toHaveBeenCalledTimes(1);
  });

  it('deletes the row even when partial-spawn kill hangs, then times out the kill', async () => {
    vi.useFakeTimers();
    mocks.spawnTerminal.mockRejectedValueOnce(new Error('spawn failed'));
    mocks.killTerminal.mockReturnValueOnce(new Promise<void>(() => {}));
    trackSession(params.projectId, params.taskId, params.id);

    const creation = createTerminal(params);
    await vi.advanceTimersByTimeAsync(0);

    expect(terminalCount(params.taskId)).toBe(0);
    await vi.advanceTimersByTimeAsync(TERMINAL_ROLLBACK_KILL_TIMEOUT_MS);
    await expect(creation).rejects.toThrow('spawn failed');
  });

  it('rate-limits before persistence and permits creation after the burst expires', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-01T00:00:00.000Z'));
    const projectId = 'project-burst';
    const taskId = 'task-burst';
    seedTask(projectId, taskId);
    const transactionSpy = vi.spyOn(state.db, 'transaction');

    for (let index = 0; index < 32; index += 1) {
      const id = `terminal-burst-${index}`;
      trackSession(projectId, taskId, id);
      await createTerminal({ id, projectId, taskId, name: `Terminal ${index}` });
    }

    await expect(
      createTerminal({ id: 'terminal-burst-overflow', projectId, taskId, name: 'Overflow' })
    ).rejects.toThrow('rate limit exceeded');
    expect(terminalCount(taskId)).toBe(32);
    expect(transactionSpy).toHaveBeenCalledTimes(32);

    vi.advanceTimersByTime(10_001);
    trackSession(projectId, taskId, 'terminal-burst-after-expiry');
    await expect(
      createTerminal({
        id: 'terminal-burst-after-expiry',
        projectId,
        taskId,
        name: 'After expiry',
      })
    ).resolves.toMatchObject({ id: 'terminal-burst-after-expiry' });
    expect(terminalCount(taskId)).toBe(33);
    expect(transactionSpy).toHaveBeenCalledTimes(33);
  });
});
