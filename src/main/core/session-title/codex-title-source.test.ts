import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CodexSessionTitleSource,
  findNewCodexThreadTitle,
  findRecentCodexThreadTitle,
  readCodexThreadTitle,
  resolveCodexStatePath,
} from './codex-title-source';

const codexState = vi.hoisted(() => ({
  rows: [] as Array<{
    id: string;
    cwd: string;
    title: string;
    createdAtMs: number;
    updatedAtMs: number;
    archived: number;
  }>,
}));

vi.mock('better-sqlite3', () => {
  class FakeDatabase {
    pragma(): void {}

    close(): void {}

    prepare(sql: string): { get: (...args: unknown[]) => unknown } {
      if (sql.includes('createdAtMs') && sql.includes('ASC')) {
        return {
          get: (cwd, minCreatedAtMs, maxCreatedAtMs) =>
            codexState.rows
              .filter(
                (row) =>
                  row.cwd === cwd &&
                  row.archived === 0 &&
                  row.createdAtMs >= Number(minCreatedAtMs) &&
                  row.createdAtMs <= Number(maxCreatedAtMs)
              )
              .sort((a, b) => a.createdAtMs - b.createdAtMs || a.id.localeCompare(b.id))[0],
        };
      }
      if (sql.includes('WHERE cwd = ?')) {
        return {
          get: (cwd, minUpdatedAtMs) =>
            codexState.rows
              .filter(
                (row) =>
                  row.cwd === cwd && row.archived === 0 && row.updatedAtMs >= Number(minUpdatedAtMs)
              )
              .sort((a, b) => b.updatedAtMs - a.updatedAtMs || b.id.localeCompare(a.id))[0],
        };
      }
      if (sql.includes('WHERE id = ?')) {
        return {
          get: (threadId) => codexState.rows.find((row) => row.id === threadId),
        };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    }
  }

  return { default: FakeDatabase };
});

describe('CodexSessionTitleSource helpers', () => {
  let dir: string;
  let statePath: string;

  beforeEach(() => {
    codexState.rows = [];
    dir = mkdtempSync(join(tmpdir(), 'yoda-codex-state-'));
    statePath = join(dir, 'state_5.sqlite');
    writeFileSync(statePath, '');
  });

  afterEach(() => {
    vi.useRealTimers();
    rmSync(dir, { recursive: true, force: true });
  });

  it('resolves the state db inside Codex home', () => {
    expect(resolveCodexStatePath('/tmp/codex-home')).toBe('/tmp/codex-home/state_5.sqlite');
  });

  it('finds the newest active Codex thread for the current cwd', () => {
    insertThread({ id: 'old', cwd: '/repo', title: 'Old title', updatedAtMs: 1_000 });
    insertThread({
      id: 'archived',
      cwd: '/repo',
      title: 'Archived title',
      updatedAtMs: 4_000,
      archived: 1,
    });
    insertThread({ id: 'other-cwd', cwd: '/other', title: 'Other title', updatedAtMs: 5_000 });
    insertThread({ id: 'current', cwd: '/repo', title: '  Current title  ', updatedAtMs: 3_000 });

    expect(
      findRecentCodexThreadTitle({
        statePath,
        cwd: '/repo',
        minUpdatedAtMs: 2_000,
      })
    ).toEqual({
      id: 'current',
      cwd: '/repo',
      title: 'Current title',
      createdAtMs: 3_000,
      updatedAtMs: 3_000,
    });
  });

  it('binds a new session by thread creation time, not the newest updated thread', () => {
    insertThread({
      id: 'current-session',
      cwd: '/repo',
      title: 'Current session',
      createdAtMs: 2_000,
      updatedAtMs: 4_000,
    });
    insertThread({
      id: 'later-session',
      cwd: '/repo',
      title: 'Later session',
      createdAtMs: 8_000,
      updatedAtMs: 9_000,
    });

    expect(
      findNewCodexThreadTitle({
        statePath,
        cwd: '/repo',
        minCreatedAtMs: 1_500,
        maxCreatedAtMs: 6_000,
      })
    ).toEqual({
      id: 'current-session',
      cwd: '/repo',
      title: 'Current session',
      createdAtMs: 2_000,
      updatedAtMs: 4_000,
    });
  });

  it('does not skip an empty early thread and bind a later session title', () => {
    insertThread({
      id: 'pending-current-session',
      cwd: '/repo',
      title: '',
      createdAtMs: 2_000,
      updatedAtMs: 2_500,
    });
    insertThread({
      id: 'later-session',
      cwd: '/repo',
      title: 'Later session',
      createdAtMs: 3_000,
      updatedAtMs: 3_500,
    });

    expect(
      findNewCodexThreadTitle({
        statePath,
        cwd: '/repo',
        minCreatedAtMs: 1_500,
        maxCreatedAtMs: 6_000,
      })
    ).toBeUndefined();
  });

  it('assigns a shared-cwd new thread to the closest fresh watcher', () => {
    vi.useFakeTimers();
    vi.setSystemTime(5_100);
    const source = new CodexSessionTitleSource();
    const oldTitles: string[] = [];
    const newTitles: string[] = [];
    const oldWatcher = source.watch(
      {
        providerId: 'codex',
        conversationId: 'old-conversation',
        projectId: 'project',
        taskId: 'old-task',
        cwd: '/repo',
        startedAtMs: 1_000,
        isResuming: false,
      },
      (title) => oldTitles.push(title)
    );
    const newWatcher = source.watch(
      {
        providerId: 'codex',
        conversationId: 'new-conversation',
        projectId: 'project',
        taskId: 'new-task',
        cwd: '/repo',
        startedAtMs: 5_000,
        isResuming: false,
      },
      (title) => newTitles.push(title)
    );

    insertThread({
      id: 'new-thread',
      cwd: '/repo',
      title: 'New thread title',
      createdAtMs: 5_050,
      updatedAtMs: 5_100,
    });

    try {
      vi.runOnlyPendingTimers();

      expect(oldTitles).toEqual([]);
      expect(newTitles).toEqual(['New thread title']);
    } finally {
      oldWatcher.stop();
      newWatcher.stop();
    }
  });

  it('reads an already-bound Codex thread title by id', () => {
    insertThread({ id: 'thread-1', cwd: '/repo', title: 'Renamed by Codex', updatedAtMs: 6_000 });

    expect(readCodexThreadTitle(statePath, 'thread-1')).toEqual({
      id: 'thread-1',
      cwd: '/repo',
      title: 'Renamed by Codex',
      createdAtMs: 6_000,
      updatedAtMs: 6_000,
    });
  });

  it('returns undefined when Codex state is missing', () => {
    expect(
      findRecentCodexThreadTitle({
        statePath: join(dir, 'missing.sqlite'),
        cwd: '/repo',
        minUpdatedAtMs: 0,
      })
    ).toBeUndefined();
  });

  function insertThread(params: {
    id: string;
    cwd: string;
    title: string;
    updatedAtMs: number;
    createdAtMs?: number;
    archived?: number;
  }): void {
    codexState.rows.push({
      id: params.id,
      cwd: params.cwd,
      title: params.title,
      createdAtMs: params.createdAtMs ?? params.updatedAtMs,
      updatedAtMs: params.updatedAtMs,
      archived: params.archived ?? 0,
    });
  }
});
