import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CodexSessionTitleSource,
  findAcknowledgedCodexThreadForInitialPrompt,
  findNewCodexThreadTitle,
  findRecentCodexThreadTitle,
  getClaimedCodexThreadId,
  readCodexThreadRolloutPaths,
  readCodexThreadTitle,
  resolveCodexStatePath,
} from './codex-title-source';

const codexState = vi.hoisted(() => ({
  openCount: 0,
  rows: [] as Array<{
    id: string;
    cwd: string;
    title: string;
    firstUserMessage: string;
    createdAtMs: number;
    updatedAtMs: number;
    archived: number;
    rolloutPath?: string;
    tokensUsed?: number;
  }>,
}));

const READY_POLL_INTERVAL_MS_FOR_TEST = 1_000;

vi.mock('better-sqlite3', () => {
  class FakeDatabase {
    constructor() {
      codexState.openCount += 1;
    }

    pragma(): void {}

    close(): void {}

    prepare(sql: string): { get: (...args: unknown[]) => unknown } {
      if (sql.includes('? IS NULL') && sql.includes('id > ?')) {
        return {
          get: (cwd, minCreatedAtMs, maxCreatedAtMs, afterCreatedAtMs, _after2, _after3, afterId) =>
            codexState.rows
              .filter(
                (row) =>
                  row.cwd === cwd &&
                  row.archived === 0 &&
                  row.title.trim().length > 0 &&
                  row.createdAtMs >= Number(minCreatedAtMs) &&
                  row.createdAtMs <= Number(maxCreatedAtMs) &&
                  (afterCreatedAtMs === null ||
                    row.createdAtMs > Number(afterCreatedAtMs) ||
                    (row.createdAtMs === Number(afterCreatedAtMs) && row.id > String(afterId)))
              )
              .sort((a, b) => a.createdAtMs - b.createdAtMs || a.id.localeCompare(b.id))[0],
        };
      }
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
    codexState.openCount = 0;
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
    expect(resolveCodexStatePath('/tmp/codex-home')).toBe(
      join('/tmp/codex-home', 'state_5.sqlite')
    );
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
      firstUserMessage: '',
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
      firstUserMessage: '',
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
    const newBindings: string[] = [];
    const oldWatcher = source.watch(
      {
        runtimeId: 'codex',
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
        runtimeId: 'codex',
        conversationId: 'new-conversation',
        projectId: 'project',
        taskId: 'new-task',
        cwd: '/repo',
        startedAtMs: 5_000,
        isResuming: false,
      },
      (title) => newTitles.push(title),
      (sessionId) => {
        newBindings.push(sessionId);
      }
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
      expect(newBindings).toEqual(['new-thread']);
    } finally {
      oldWatcher.stop();
      newWatcher.stop();
    }
  });

  it('does not let a closer different-prompt watcher block the correct shared-cwd owner', () => {
    vi.useFakeTimers();
    vi.setSystemTime(5_100);
    const rolloutPath = join(dir, 'shared-prompt-rollout.jsonl');
    writeFileSync(
      rolloutPath,
      `${JSON.stringify({ type: 'event_msg', payload: { type: 'task_started' } })}\n`
    );
    const source = new CodexSessionTitleSource();
    const wrongBindings: string[] = [];
    const correctBindings: string[] = [];
    const wrongWatcher = source.watch(
      {
        runtimeId: 'codex',
        conversationId: 'wrong-prompt-conversation',
        projectId: 'project',
        taskId: 'wrong-task',
        cwd: '/repo',
        startedAtMs: 5_040,
        isResuming: false,
        waitForInitialPrompt: true,
        expectedInitialPrompt: 'First task',
      },
      () => {},
      (sessionId) => {
        wrongBindings.push(sessionId);
      }
    );
    const correctWatcher = source.watch(
      {
        runtimeId: 'codex',
        conversationId: 'correct-prompt-conversation',
        projectId: 'project',
        taskId: 'correct-task',
        cwd: '/repo',
        startedAtMs: 5_000,
        isResuming: false,
        waitForInitialPrompt: true,
        expectedInitialPrompt: 'Second task',
      },
      () => {},
      (sessionId) => {
        correctBindings.push(sessionId);
      }
    );
    insertThread({
      id: 'second-thread',
      cwd: '/repo',
      title: 'Second task',
      firstUserMessage: 'Second task',
      createdAtMs: 5_050,
      updatedAtMs: 5_100,
      rolloutPath,
    });

    try {
      vi.runOnlyPendingTimers();
      expect(wrongBindings).toEqual([]);
      expect(correctBindings).toEqual(['second-thread']);
    } finally {
      wrongWatcher.stop();
      correctWatcher.stop();
    }
  });

  it('waits for exact first-turn evidence before binding a fresh prompt', () => {
    vi.useFakeTimers();
    vi.setSystemTime(5_100);
    const rolloutPath = join(dir, 'pending-rollout.jsonl');
    writeFileSync(
      rolloutPath,
      `${JSON.stringify({ type: 'session_meta', payload: { id: 'pending-thread' } })}\n`
    );
    const source = new CodexSessionTitleSource();
    const bindings: string[] = [];
    const watcher = source.watch(
      {
        runtimeId: 'codex',
        conversationId: 'pending-conversation',
        projectId: 'project',
        taskId: 'task',
        cwd: '/repo',
        startedAtMs: 5_000,
        isResuming: false,
        waitForInitialPrompt: true,
        expectedInitialPrompt: 'Ship the correct task',
      },
      () => {},
      (sessionId) => {
        bindings.push(sessionId);
      }
    );
    insertThread({
      id: 'pending-thread',
      cwd: '/repo',
      title: 'Starting',
      firstUserMessage: 'Ship the correct task',
      createdAtMs: 5_050,
      updatedAtMs: 5_100,
      rolloutPath,
    });

    try {
      vi.runOnlyPendingTimers();
      expect(bindings).toEqual([]);

      writeFileSync(
        rolloutPath,
        [
          JSON.stringify({ type: 'session_meta', payload: { id: 'pending-thread' } }),
          JSON.stringify({ type: 'event_msg', payload: { type: 'task_started' } }),
        ].join('\n')
      );
      vi.runOnlyPendingTimers();

      expect(bindings).toEqual(['pending-thread']);
    } finally {
      watcher.stop();
    }
  });

  it('keeps watching an old attempt window after reattach starts a new poll lifetime', () => {
    vi.useFakeTimers();
    vi.setSystemTime(400_000);
    const rolloutPath = join(dir, 'late-reattach-rollout.jsonl');
    writeFileSync(
      rolloutPath,
      `${JSON.stringify({ type: 'event_msg', payload: { type: 'task_started' } })}\n`
    );
    const source = new CodexSessionTitleSource();
    const bindings: string[] = [];
    const watcher = source.watch(
      {
        runtimeId: 'codex',
        conversationId: 'late-reattach-conversation',
        projectId: 'project',
        taskId: 'task',
        cwd: '/repo',
        startedAtMs: 5_000,
        isResuming: false,
        waitForInitialPrompt: true,
        expectedInitialPrompt: 'Restore old attempt',
      },
      () => {},
      (sessionId) => {
        bindings.push(sessionId);
      }
    );

    try {
      vi.advanceTimersByTime(0);
      expect(bindings).toEqual([]);

      insertThread({
        id: 'late-reattach-thread',
        cwd: '/repo',
        title: 'Restore old attempt',
        firstUserMessage: 'Restore old attempt',
        createdAtMs: 5_050,
        updatedAtMs: 5_100,
        rolloutPath,
      });
      vi.advanceTimersByTime(READY_POLL_INTERVAL_MS_FOR_TEST);

      expect(bindings).toEqual(['late-reattach-thread']);
    } finally {
      watcher.stop();
    }
  });

  it('reconciles an acknowledged first turn from an earlier delivery attempt', () => {
    const rolloutPath = join(dir, 'acknowledged-rollout.jsonl');
    writeFileSync(
      rolloutPath,
      `${JSON.stringify({ type: 'event_msg', payload: { type: 'task_started' } })}\n`
    );
    insertThread({
      id: 'acknowledged-thread',
      cwd: '/repo',
      title: 'Restore this task',
      firstUserMessage: 'Restore this task',
      createdAtMs: 5_050,
      updatedAtMs: 5_100,
      rolloutPath,
    });

    expect(
      findAcknowledgedCodexThreadForInitialPrompt({
        statePath,
        cwd: '/repo',
        attemptStartedAtMs: 5_000,
        expectedInitialPrompt: 'Restore this task',
      })
    ).toEqual(expect.objectContaining({ id: 'acknowledged-thread' }));
  });

  it('does not preflight-bind a routed turn before its interruption window settles', () => {
    vi.useFakeTimers();
    vi.setSystemTime(5_100);
    const rolloutPath = join(dir, 'routed-preflight-rollout.jsonl');
    writeFileSync(
      rolloutPath,
      `${JSON.stringify({ type: 'event_msg', payload: { type: 'task_started' } })}\n`
    );
    insertThread({
      id: 'routed-preflight-thread',
      cwd: '/repo',
      title: '$solu restore twitter',
      firstUserMessage: '$solu restore twitter',
      createdAtMs: 5_050,
      updatedAtMs: 5_100,
      rolloutPath,
      tokensUsed: 1,
    });
    const params = {
      statePath,
      cwd: '/repo',
      attemptStartedAtMs: 5_000,
      expectedInitialPrompt: '$solu restore twitter',
    };

    expect(findAcknowledgedCodexThreadForInitialPrompt(params)).toBeUndefined();
    vi.setSystemTime(16_000);
    expect(findAcknowledgedCodexThreadForInitialPrompt(params)).toEqual(
      expect.objectContaining({ id: 'routed-preflight-thread' })
    );
  });

  it('does not claim a same-cwd turn whose prompt belongs to another watcher', () => {
    vi.useFakeTimers();
    vi.setSystemTime(5_100);
    const rolloutPath = join(dir, 'other-rollout.jsonl');
    writeFileSync(
      rolloutPath,
      `${JSON.stringify({ type: 'event_msg', payload: { type: 'task_started' } })}\n`
    );
    const source = new CodexSessionTitleSource();
    const bindings: string[] = [];
    const watcher = source.watch(
      {
        runtimeId: 'codex',
        conversationId: 'expected-conversation',
        projectId: 'project',
        taskId: 'task',
        cwd: '/repo',
        startedAtMs: 5_000,
        isResuming: false,
        waitForInitialPrompt: true,
        expectedInitialPrompt: 'Expected task',
      },
      () => {},
      (sessionId) => {
        bindings.push(sessionId);
      }
    );
    insertThread({
      id: 'other-thread',
      cwd: '/repo',
      title: 'Other task',
      firstUserMessage: 'Other task',
      createdAtMs: 5_050,
      updatedAtMs: 5_100,
      rolloutPath,
    });

    try {
      vi.runOnlyPendingTimers();
      expect(bindings).toEqual([]);
      expect(getClaimedCodexThreadId('expected-conversation')).toBeUndefined();
    } finally {
      watcher.stop();
    }
  });

  it('skips a rejected owner and binds the next matching thread before publishing', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(5_100);
    const rolloutPath = join(dir, 'retry-rollout.jsonl');
    writeFileSync(
      rolloutPath,
      `${JSON.stringify({ type: 'event_msg', payload: { type: 'task_started' } })}\n`
    );
    const source = new CodexSessionTitleSource();
    const onSessionBound = vi
      .fn<() => Promise<boolean>>()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const titles: string[] = [];
    const watcher = source.watch(
      {
        runtimeId: 'codex',
        conversationId: 'retry-conversation',
        projectId: 'project',
        taskId: 'task',
        cwd: '/repo',
        startedAtMs: 5_000,
        isResuming: false,
        waitForInitialPrompt: true,
        expectedInitialPrompt: 'Retry task',
      },
      (title) => titles.push(title),
      onSessionBound
    );
    insertThread({
      id: 'retry-thread',
      cwd: '/repo',
      title: 'Renamed retry task',
      firstUserMessage: 'Retry task',
      createdAtMs: 5_050,
      updatedAtMs: 5_100,
      rolloutPath,
    });

    try {
      await vi.advanceTimersByTimeAsync(0);
      expect(onSessionBound).toHaveBeenCalledTimes(1);
      expect(titles).toEqual([]);

      insertThread({
        id: 'accepted-retry-thread',
        cwd: '/repo',
        title: 'Accepted retry task',
        firstUserMessage: 'Retry task',
        createdAtMs: 5_060,
        updatedAtMs: 5_200,
        rolloutPath,
      });
      await vi.advanceTimersByTimeAsync(READY_POLL_INTERVAL_MS_FOR_TEST);
      expect(onSessionBound).toHaveBeenCalledTimes(2);
      expect(titles).toEqual([]);

      await vi.advanceTimersByTimeAsync(READY_POLL_INTERVAL_MS_FOR_TEST);
      expect(titles).toEqual(['Accepted retry task']);
    } finally {
      watcher.stop();
    }
  });

  it('keeps a thread claimed while a stopped watcher finishes durable binding', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(5_100);
    const rolloutPath = join(dir, 'in-flight-rollout.jsonl');
    writeFileSync(
      rolloutPath,
      `${JSON.stringify({ type: 'event_msg', payload: { type: 'task_started' } })}\n`
    );
    let resolveBinding!: (stored: boolean) => void;
    const binding = new Promise<boolean>((resolve) => {
      resolveBinding = resolve;
    });
    const source = new CodexSessionTitleSource();
    const firstWatcher = source.watch(
      {
        runtimeId: 'codex',
        conversationId: 'in-flight-owner',
        projectId: 'project',
        taskId: 'first-task',
        cwd: '/repo',
        startedAtMs: 5_000,
        isResuming: false,
        waitForInitialPrompt: true,
        expectedInitialPrompt: 'Shared prompt',
      },
      () => {},
      () => binding
    );
    insertThread({
      id: 'in-flight-thread',
      cwd: '/repo',
      title: 'Shared prompt',
      firstUserMessage: 'Shared prompt',
      createdAtMs: 5_050,
      updatedAtMs: 5_100,
      rolloutPath,
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(getClaimedCodexThreadId('in-flight-owner')).toBe('in-flight-thread');
    firstWatcher.stop();

    const secondBindings: string[] = [];
    const secondWatcher = source.watch(
      {
        runtimeId: 'codex',
        conversationId: 'in-flight-contender',
        projectId: 'project',
        taskId: 'second-task',
        cwd: '/repo',
        startedAtMs: 5_001,
        isResuming: false,
        waitForInitialPrompt: true,
        expectedInitialPrompt: 'Shared prompt',
      },
      () => {},
      (sessionId) => {
        secondBindings.push(sessionId);
      }
    );

    try {
      await vi.advanceTimersByTimeAsync(0);
      expect(secondBindings).toEqual([]);

      resolveBinding(true);
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(READY_POLL_INTERVAL_MS_FOR_TEST);

      expect(getClaimedCodexThreadId('in-flight-owner')).toBe('in-flight-thread');
      expect(secondBindings).toEqual([]);
    } finally {
      secondWatcher.stop();
    }
  });

  it('rebinds a routed conversation from an interrupted stub to its relaunched thread', () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    const source = new CodexSessionTitleSource();
    const bindings: string[] = [];
    const stubRolloutPath = join(dir, 'stub.jsonl');
    writeFileSync(
      stubRolloutPath,
      [
        JSON.stringify({ type: 'session_meta', payload: { id: 'stub-thread' } }),
        JSON.stringify({
          type: 'response_item',
          payload: { type: 'message', role: 'user' },
        }),
        JSON.stringify({
          type: 'event_msg',
          payload: { type: 'turn_aborted', reason: 'interrupted' },
        }),
      ].join('\n')
    );
    const watcher = source.watch(
      {
        runtimeId: 'codex',
        conversationId: 'routed-conversation',
        projectId: 'project',
        taskId: 'task',
        cwd: '/repo',
        startedAtMs: 10_000,
        isResuming: false,
      },
      () => {},
      (sessionId) => {
        bindings.push(sessionId);
      }
    );

    insertThread({
      id: 'stub-thread',
      cwd: '/repo',
      title: '$solu 接入 twitter',
      firstUserMessage: '$solu 接入 twitter',
      createdAtMs: 10_100,
      updatedAtMs: 10_200,
      rolloutPath: stubRolloutPath,
      tokensUsed: 0,
    });

    try {
      vi.advanceTimersByTime(0);
      expect(bindings).toEqual(['stub-thread']);

      insertThread({
        id: 'real-thread',
        cwd: '/repo',
        title: '$solution-architect  接入 twitter',
        firstUserMessage: '$solution-architect  接入 twitter',
        createdAtMs: 10_500,
        updatedAtMs: 11_000,
        tokensUsed: 1,
      });
      vi.advanceTimersByTime(1_000);

      expect(bindings).toEqual(['stub-thread', 'real-thread']);
    } finally {
      watcher.stop();
    }
  });

  it('waits past an interrupted routed stub and binds the relaunched first turn', () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    const source = new CodexSessionTitleSource();
    const bindings: string[] = [];
    const stubRolloutPath = join(dir, 'pending-stub.jsonl');
    const realRolloutPath = join(dir, 'pending-real.jsonl');
    writeFileSync(
      stubRolloutPath,
      [
        JSON.stringify({ type: 'session_meta', payload: { id: 'pending-stub' } }),
        JSON.stringify({
          type: 'response_item',
          payload: { type: 'message', role: 'user' },
        }),
        JSON.stringify({
          type: 'event_msg',
          payload: { type: 'turn_aborted', reason: 'interrupted' },
        }),
      ].join('\n')
    );
    writeFileSync(
      realRolloutPath,
      `${JSON.stringify({ type: 'event_msg', payload: { type: 'task_started' } })}\n`
    );
    const watcher = source.watch(
      {
        runtimeId: 'codex',
        conversationId: 'pending-routed-conversation',
        projectId: 'project',
        taskId: 'task',
        cwd: '/repo',
        startedAtMs: 10_000,
        isResuming: false,
        waitForInitialPrompt: true,
        expectedInitialPrompt: '$solu 接入 twitter',
      },
      () => {},
      (sessionId) => {
        bindings.push(sessionId);
      }
    );

    insertThread({
      id: 'pending-stub',
      cwd: '/repo',
      title: '$solu 接入 twitter',
      firstUserMessage: '$solu 接入 twitter',
      createdAtMs: 10_100,
      updatedAtMs: 20_000,
      rolloutPath: stubRolloutPath,
      tokensUsed: 0,
    });

    try {
      vi.advanceTimersByTime(0);
      expect(bindings).toEqual([]);

      insertThread({
        id: 'unrelated-middle-thread',
        cwd: '/repo',
        title: '',
        firstUserMessage: '',
        createdAtMs: 10_300,
        updatedAtMs: 10_400,
        rolloutPath: realRolloutPath,
        tokensUsed: 1,
      });
      insertThread({
        id: 'pending-real',
        cwd: '/repo',
        title: '$solution-architect 接入 twitter',
        firstUserMessage: '$solution-architect 接入 twitter',
        createdAtMs: 10_500,
        updatedAtMs: 11_000,
        rolloutPath: realRolloutPath,
        tokensUsed: 1,
      });
      vi.setSystemTime(21_000);
      vi.advanceTimersByTime(1_000);

      expect(bindings).toEqual(['pending-real']);
    } finally {
      watcher.stop();
    }
  });

  it('reads an already-bound Codex thread title by id', () => {
    insertThread({ id: 'thread-1', cwd: '/repo', title: 'Renamed by Codex', updatedAtMs: 6_000 });

    expect(readCodexThreadTitle(statePath, 'thread-1')).toEqual({
      id: 'thread-1',
      cwd: '/repo',
      title: 'Renamed by Codex',
      firstUserMessage: '',
      createdAtMs: 6_000,
      updatedAtMs: 6_000,
    });
  });

  it('reads exact rollout bindings through one readonly state DB handle', () => {
    insertThread({
      id: 'thread-1',
      cwd: '/repo',
      title: 'One',
      updatedAtMs: 6_000,
      rolloutPath: '/rollouts/one.jsonl',
    });
    insertThread({
      id: 'thread-2',
      cwd: '/repo',
      title: 'Two',
      updatedAtMs: 7_000,
      rolloutPath: '/rollouts/two.jsonl',
    });

    expect(
      readCodexThreadRolloutPaths(statePath, ['thread-1', 'missing', 'thread-2', 'thread-1'])
    ).toEqual(
      new Map([
        ['thread-1', '/rollouts/one.jsonl'],
        ['thread-2', '/rollouts/two.jsonl'],
      ])
    );
    expect(codexState.openCount).toBe(1);
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
    firstUserMessage?: string;
    updatedAtMs: number;
    createdAtMs?: number;
    archived?: number;
    rolloutPath?: string;
    tokensUsed?: number;
  }): void {
    codexState.rows.push({
      id: params.id,
      cwd: params.cwd,
      title: params.title,
      firstUserMessage: params.firstUserMessage ?? '',
      createdAtMs: params.createdAtMs ?? params.updatedAtMs,
      updatedAtMs: params.updatedAtMs,
      archived: params.archived ?? 0,
      ...(params.rolloutPath ? { rolloutPath: params.rolloutPath } : {}),
      ...(params.tokensUsed === undefined ? {} : { tokensUsed: params.tokensUsed }),
    });
  }
});
