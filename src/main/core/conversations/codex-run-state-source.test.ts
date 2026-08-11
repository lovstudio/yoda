import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  classifyCodexRollout,
  initialCodexTailEvents,
  parseCodexRunStateEvent,
  parseTurnEvent,
  readCodexTurnVerdict,
  readCodexTurnVerdictFile,
  resolveCodexRolloutPathForConversation,
  watchCodexRunState,
} from './codex-run-state-source';

const ts = '2026-06-08T17:49:25.314Z';
const at = Date.parse(ts);

function line(payload: Record<string, unknown>, type = 'event_msg'): string {
  return JSON.stringify({ timestamp: ts, type, payload });
}

describe('parseTurnEvent', () => {
  it('maps task_started → turn-started', () => {
    expect(parseTurnEvent(line({ type: 'task_started', turn_id: 't1' }))).toEqual({
      kind: 'turn-started',
      at,
    });
  });

  it('maps task_complete → turn-completed', () => {
    expect(
      parseTurnEvent(line({ type: 'task_complete', turn_id: 't1', last_agent_message: 'done' }))
    ).toEqual({ kind: 'turn-completed', at });
  });

  it('maps turn_aborted(reason=interrupted) → turn-interrupted (non-terminal)', () => {
    expect(
      parseTurnEvent(line({ type: 'turn_aborted', turn_id: 't1', reason: 'interrupted' }))
    ).toEqual({ kind: 'turn-interrupted', at });
  });

  it('maps turn_aborted(other reason) → turn-failed', () => {
    expect(
      parseTurnEvent(line({ type: 'turn_aborted', turn_id: 't1', reason: 'replaced' }))
    ).toEqual({ kind: 'turn-failed', at });
  });

  it('ignores non-turn event_msg rows', () => {
    expect(parseTurnEvent(line({ type: 'agent_message', message: 'hi' }))).toBeNull();
    expect(parseTurnEvent(line({ type: 'token_count' }))).toBeNull();
  });

  it('ignores non-event_msg rows', () => {
    expect(parseTurnEvent(line({ type: 'function_call' }, 'response_item'))).toBeNull();
    expect(parseTurnEvent(JSON.stringify({ type: 'session_meta', payload: {} }))).toBeNull();
  });

  it('ignores malformed lines', () => {
    expect(parseTurnEvent('not json')).toBeNull();
    expect(parseTurnEvent('')).toBeNull();
    expect(parseTurnEvent('null')).toBeNull();
    expect(parseTurnEvent('{"type":"event_msg"}')).toBeNull();
  });

  it('falls back to now when timestamp is missing/invalid', () => {
    const result = parseTurnEvent(
      JSON.stringify({ type: 'event_msg', payload: { type: 'task_started' } })
    );
    expect(result?.kind).toBe('turn-started');
    expect(typeof result?.at).toBe('number');
  });
});

describe('parseCodexRunStateEvent', () => {
  it('maps request_user_input function call to awaiting-input and output to forced working', () => {
    const pending = new Set<string>();
    const request = JSON.stringify({
      timestamp: ts,
      type: 'response_item',
      payload: {
        type: 'function_call',
        name: 'request_user_input',
        arguments: JSON.stringify({
          questions: [{ question: 'Which option should we use?' }],
        }),
        call_id: 'call_question',
      },
    });
    const output = JSON.stringify({
      timestamp: ts,
      type: 'response_item',
      payload: {
        type: 'function_call_output',
        call_id: 'call_question',
        output: '{"answers":{}}',
      },
    });

    expect(parseCodexRunStateEvent(request, pending)).toEqual({
      kind: 'awaiting-input',
      at,
      pendingAction: {
        notificationType: 'elicitation_dialog',
        toolName: 'request_user_input',
        actionDescription: 'Which option should we use?',
      },
    });
    expect(pending.has('call_question')).toBe(true);
    expect(parseCodexRunStateEvent(output, pending)).toEqual({
      kind: 'turn-started',
      at,
      force: true,
    });
    expect(pending.has('call_question')).toBe(false);
  });

  it('resumes working after an approved shell function call produces output', () => {
    const pending = new Set<string>();
    const call = JSON.stringify({
      timestamp: ts,
      type: 'response_item',
      payload: {
        type: 'function_call',
        name: 'shell',
        arguments: JSON.stringify({ command: ['printf', 'ok'] }),
        call_id: 'call_shell',
      },
    });
    const output = JSON.stringify({
      timestamp: ts,
      type: 'response_item',
      payload: {
        type: 'function_call_output',
        call_id: 'call_shell',
        output: 'ok',
      },
    });

    expect(parseCodexRunStateEvent(call, pending)).toBeNull();
    expect(pending.has('call_shell')).toBe(true);
    expect(parseCodexRunStateEvent(output, pending)).toEqual({
      kind: 'turn-started',
      at,
      force: true,
    });
    expect(pending.has('call_shell')).toBe(false);
  });

  it('resumes working after a custom tool call produces output', () => {
    const pending = new Set<string>();
    const call = JSON.stringify({
      timestamp: ts,
      type: 'response_item',
      payload: {
        type: 'custom_tool_call',
        name: 'exec',
        input: 'printf ok',
        call_id: 'call_custom_shell',
      },
    });
    const output = JSON.stringify({
      timestamp: ts,
      type: 'response_item',
      payload: {
        type: 'custom_tool_call_output',
        call_id: 'call_custom_shell',
        output: 'ok',
      },
    });

    expect(parseCodexRunStateEvent(call, pending)).toBeNull();
    expect(pending.has('call_custom_shell')).toBe(true);
    expect(parseCodexRunStateEvent(output, pending)).toEqual({
      kind: 'turn-started',
      at,
      force: true,
    });
    expect(pending.has('call_custom_shell')).toBe(false);
  });
});

describe('initialCodexTailEvents', () => {
  it('does not replay a historical completion when an idle session watcher attaches', () => {
    const lines = [
      line({ type: 'task_started', turn_id: 'old' }),
      line({ type: 'task_complete', turn_id: 'old' }),
    ];

    expect(initialCodexTailEvents(lines, at + 60_000)).toEqual([]);
  });

  it('restores a historical turn that is still working without marking it finished', () => {
    const lines = [
      line({ type: 'task_started', turn_id: 'old' }),
      line({ type: 'task_complete', turn_id: 'old' }),
      JSON.stringify({
        timestamp: '2026-06-08T17:50:00.000Z',
        type: 'event_msg',
        payload: { type: 'task_started', turn_id: 'active' },
      }),
    ];

    expect(initialCodexTailEvents(lines, at + 120_000)).toEqual([
      { kind: 'turn-started', at: Date.parse('2026-06-08T17:50:00.000Z'), force: true },
    ]);
  });

  it('replays terminal events written after the watcher started', () => {
    const startedAt = at - 1;
    const lines = [
      line({ type: 'task_started', turn_id: 'new' }),
      line({ type: 'task_complete', turn_id: 'new' }),
    ];

    expect(initialCodexTailEvents(lines, startedAt)).toEqual([
      { kind: 'turn-started', at },
      { kind: 'turn-completed', at },
    ]);
  });
});

describe('classifyCodexRollout', () => {
  it('returns working with the last task_started timestamp', () => {
    const nextTs = '2026-06-08T17:50:00.000Z';
    const nextAt = Date.parse(nextTs);
    const raw = [
      line({ type: 'task_started', turn_id: 't1' }),
      line({ type: 'task_complete', turn_id: 't1' }),
      JSON.stringify({
        timestamp: nextTs,
        type: 'event_msg',
        payload: { type: 'task_started', turn_id: 't2' },
      }),
    ].join('\n');

    expect(classifyCodexRollout(raw)).toEqual({ state: 'working', lastStartedAt: nextAt });
  });

  it('returns idle after an interrupted turn', () => {
    const raw = [
      line({ type: 'task_started', turn_id: 't1' }),
      line({ type: 'turn_aborted', turn_id: 't1', reason: 'interrupted' }),
    ].join('\n');

    expect(classifyCodexRollout(raw)).toEqual({ state: 'idle', lastStartedAt: at });
  });

  it('returns awaiting-input while request_user_input has no output', () => {
    const raw = [
      line({ type: 'task_started', turn_id: 't1' }),
      JSON.stringify({
        timestamp: ts,
        type: 'response_item',
        payload: {
          type: 'function_call',
          name: 'request_user_input',
          arguments: JSON.stringify({ questions: [{ question: 'Pick a path?' }] }),
          call_id: 'call_question',
        },
      }),
    ].join('\n');

    expect(classifyCodexRollout(raw)).toEqual({ state: 'awaiting-input', lastStartedAt: at });
  });

  it('returns working after request_user_input receives output and the turn continues', () => {
    const raw = [
      line({ type: 'task_started', turn_id: 't1' }),
      JSON.stringify({
        timestamp: ts,
        type: 'response_item',
        payload: {
          type: 'function_call',
          name: 'request_user_input',
          arguments: JSON.stringify({ questions: [{ question: 'Pick a path?' }] }),
          call_id: 'call_question',
        },
      }),
      JSON.stringify({
        timestamp: ts,
        type: 'response_item',
        payload: {
          type: 'function_call_output',
          call_id: 'call_question',
          output: '{"answers":{}}',
        },
      }),
    ].join('\n');

    expect(classifyCodexRollout(raw)).toEqual({ state: 'working', lastStartedAt: at });
  });
});

describe('readCodexTurnVerdictFile', () => {
  let dir: string | undefined;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it('fails closed when an oversized row makes the newest turn ambiguous', async () => {
    dir = mkdtempSync(join(tmpdir(), 'yoda-codex-run-state-tail-'));
    const rolloutPath = join(dir, 'rollout.jsonl');
    writeFileSync(
      rolloutPath,
      `${line({ type: 'task_started', turn_id: 't1' })}\n${JSON.stringify({
        type: 'response_item',
        payload: {
          type: 'function_call_output',
          call_id: 'unrelated',
          output: 'x'.repeat(5_000_000),
        },
      })}\n`
    );

    await expect(readCodexTurnVerdictFile(rolloutPath)).resolves.toBeNull();
  });

  it('fails closed when the newest turn boundary exceeds the total scan budget', async () => {
    dir = mkdtempSync(join(tmpdir(), 'yoda-codex-run-state-tail-'));
    const rolloutPath = join(dir, 'rollout.jsonl');
    const irrelevant = JSON.stringify({
      type: 'response_item',
      payload: { type: 'message', role: 'assistant', text: 'x'.repeat(1_000_000) },
    });
    writeFileSync(
      rolloutPath,
      `${line({ type: 'task_started', turn_id: 't1' })}\n${Array.from(
        { length: 9 },
        () => irrelevant
      ).join('\n')}\n`
    );

    await expect(readCodexTurnVerdictFile(rolloutPath)).resolves.toBeNull();
  });

  it.each([
    ['empty', ''],
    ['no turn evidence', JSON.stringify({ type: 'session_meta', payload: { id: 'thread' } })],
    [
      'a malformed newest turn row',
      `${line({ type: 'task_started', turn_id: 'old' })}\n${line({
        type: 'task_complete',
        turn_id: 'old',
      })}\n{"type":"event_msg","payload":{"type":"task_started"`,
    ],
  ])('fails closed for a rollout with %s', async (_label, contents) => {
    dir = mkdtempSync(join(tmpdir(), 'yoda-codex-run-state-tail-'));
    const rolloutPath = join(dir, 'rollout.jsonl');
    writeFileSync(rolloutPath, contents);

    await expect(readCodexTurnVerdictFile(rolloutPath)).resolves.toBeNull();
  });

  it('keeps request_user_input semantics within the newest turn only', async () => {
    dir = mkdtempSync(join(tmpdir(), 'yoda-codex-run-state-tail-'));
    const rolloutPath = join(dir, 'rollout.jsonl');
    writeFileSync(
      rolloutPath,
      [
        line({ type: 'task_started', turn_id: 'old' }),
        line({ type: 'task_complete', turn_id: 'old' }),
        line({ type: 'task_started', turn_id: 'current' }),
        JSON.stringify({
          timestamp: ts,
          type: 'response_item',
          payload: {
            type: 'function_call',
            name: 'request_user_input',
            arguments: JSON.stringify({ questions: [{ question: 'Pick a path?' }] }),
            call_id: 'call_question',
          },
        }),
      ].join('\n')
    );

    await expect(readCodexTurnVerdictFile(rolloutPath)).resolves.toEqual({
      state: 'awaiting-input',
      lastStartedAt: at,
    });
  });
});

describe('resolveCodexRolloutPathForConversation', () => {
  let dir: string | undefined;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it('resolves rollout_path by cwd and startedAt without relying on a title claim', async () => {
    dir = mkdtempSync(join(tmpdir(), 'yoda-codex-run-state-'));
    const statePath = join(dir, 'state_5.sqlite');
    const rolloutPath = join(dir, 'rollout.jsonl');
    const startedAtMs = Date.parse('2026-06-08T17:49:24.900Z');
    createStateDb(statePath);
    insertThread(statePath, {
      id: 'codex-thread-1',
      cwd: '/repo',
      rolloutPath,
      createdAtMs: Date.parse('2026-06-08T17:49:25.000Z'),
      updatedAtMs: Date.parse('2026-06-08T17:49:26.000Z'),
    });
    writeFileSync(
      rolloutPath,
      `${line({ type: 'task_started', turn_id: 't1' })}\n${line({
        type: 'turn_aborted',
        turn_id: 't1',
        reason: 'interrupted',
      })}\n`
    );

    expect(
      resolveCodexRolloutPathForConversation({
        conversationId: 'yoda-conversation-1',
        cwd: '/repo',
        startedAtMs,
        statePath,
      })
    ).toBe(rolloutPath);
    await expect(
      readCodexTurnVerdict('yoda-conversation-1', { cwd: '/repo', startedAtMs, statePath })
    ).resolves.toEqual({ state: 'idle', lastStartedAt: at });
  });

  it('waits for a new session thread instead of binding an older thread in the same cwd', () => {
    dir = mkdtempSync(join(tmpdir(), 'yoda-codex-run-state-'));
    const statePath = join(dir, 'state_5.sqlite');
    const olderRolloutPath = join(dir, 'older.jsonl');
    const expectedRolloutPath = join(dir, 'expected.jsonl');
    const startedAtMs = Date.parse('2026-06-08T17:49:25.000Z');
    createStateDb(statePath);
    writeFileSync(olderRolloutPath, `${line({ type: 'task_started', turn_id: 'older' })}\n`);
    insertThread(statePath, {
      id: 'older-thread',
      cwd: '/shared-repo',
      rolloutPath: olderRolloutPath,
      createdAtMs: startedAtMs - 30_000,
      updatedAtMs: startedAtMs + 1_000,
    });

    const context = {
      conversationId: 'new-conversation',
      cwd: '/shared-repo',
      startedAtMs,
      statePath,
    };
    expect(resolveCodexRolloutPathForConversation(context)).toBeUndefined();

    writeFileSync(expectedRolloutPath, `${line({ type: 'task_started', turn_id: 'expected' })}\n`);
    insertThread(statePath, {
      id: 'expected-thread',
      cwd: '/shared-repo',
      rolloutPath: expectedRolloutPath,
      createdAtMs: startedAtMs + 500,
      updatedAtMs: startedAtMs + 1_500,
    });

    expect(resolveCodexRolloutPathForConversation(context)).toBe(expectedRolloutPath);
  });

  it('prefers an explicit resumed thread over the most recently updated thread in the same cwd', async () => {
    dir = mkdtempSync(join(tmpdir(), 'yoda-codex-run-state-'));
    const statePath = join(dir, 'state_5.sqlite');
    const resumedRolloutPath = join(dir, 'resumed.jsonl');
    const otherRolloutPath = join(dir, 'other.jsonl');
    const startedAtMs = Date.parse('2026-07-11T07:00:00.000Z');
    createStateDb(statePath);
    writeFileSync(
      resumedRolloutPath,
      `${line({ type: 'task_started', turn_id: 'resumed' })}\n${line({
        type: 'task_complete',
        turn_id: 'resumed',
      })}\n`
    );
    writeFileSync(otherRolloutPath, `${line({ type: 'task_started', turn_id: 'other' })}\n`);
    insertThread(statePath, {
      id: 'resumed-thread',
      cwd: '/shared-repo',
      rolloutPath: resumedRolloutPath,
      createdAtMs: Date.parse('2026-07-09T01:37:01.000Z'),
      updatedAtMs: Date.parse('2026-07-09T02:00:00.000Z'),
    });
    insertThread(statePath, {
      id: 'other-task-thread',
      cwd: '/shared-repo',
      rolloutPath: otherRolloutPath,
      createdAtMs: Date.parse('2026-07-10T03:48:19.000Z'),
      updatedAtMs: Date.parse('2026-07-11T06:59:59.000Z'),
    });

    expect(
      resolveCodexRolloutPathForConversation({
        conversationId: 'yoda-conversation',
        cwd: '/shared-repo',
        startedAtMs,
        isResuming: true,
        threadId: 'resumed-thread',
        statePath,
      })
    ).toBe(resumedRolloutPath);
    await expect(
      readCodexTurnVerdict('yoda-conversation', {
        cwd: '/shared-repo',
        startedAtMs,
        isResuming: true,
        threadId: 'resumed-thread',
        statePath,
      })
    ).resolves.toEqual({ state: 'idle', lastStartedAt: at });
  });

  it('initializes a watcher from the bounded tail of a large historical rollout', async () => {
    dir = mkdtempSync(join(tmpdir(), 'yoda-codex-run-state-'));
    const statePath = join(dir, 'state_5.sqlite');
    const rolloutPath = join(dir, 'rollout.jsonl');
    createStateDb(statePath);
    insertThread(statePath, {
      id: 'large-thread',
      cwd: '/large-repo',
      rolloutPath,
      createdAtMs: at,
      updatedAtMs: at,
    });
    writeFileSync(
      rolloutPath,
      `${line({ type: 'task_started', turn_id: 'active' })}\n${Array.from({ length: 5 }, () =>
        JSON.stringify({
          type: 'response_item',
          payload: { type: 'function_call_output', output: 'x'.repeat(1_000_000) },
        })
      ).join('\n')}\n`
    );
    const events: unknown[] = [];
    const watcher = watchCodexRunState(
      {
        conversationId: 'conversation-large',
        cwd: '/large-repo',
        startedAtMs: at + 60_000,
        threadId: 'large-thread',
      },
      (event) => events.push(event),
      { statePath }
    );

    try {
      await vi.waitFor(
        () => {
          expect(events).toEqual([{ kind: 'turn-started', at, force: true }]);
        },
        { timeout: 2_000 }
      );
    } finally {
      watcher.stop();
    }
  });
});

function createStateDb(statePath: string): void {
  const db = new Database(statePath);
  try {
    db.exec(`
      CREATE TABLE threads (
        id TEXT PRIMARY KEY,
        cwd TEXT NOT NULL,
        rollout_path TEXT NOT NULL,
        archived INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        created_at_ms INTEGER,
        updated_at_ms INTEGER
      );
    `);
  } finally {
    db.close();
  }
}

function insertThread(
  statePath: string,
  args: {
    id: string;
    cwd: string;
    rolloutPath: string;
    createdAtMs: number;
    updatedAtMs: number;
  }
): void {
  const db = new Database(statePath);
  try {
    db.prepare(
      `
        INSERT INTO threads (
          id,
          cwd,
          rollout_path,
          archived,
          created_at,
          updated_at,
          created_at_ms,
          updated_at_ms
        ) VALUES (?, ?, ?, 0, ?, ?, ?, ?)
      `
    ).run(
      args.id,
      args.cwd,
      args.rolloutPath,
      Math.floor(args.createdAtMs / 1000),
      Math.floor(args.updatedAtMs / 1000),
      args.createdAtMs,
      args.updatedAtMs
    );
  } finally {
    db.close();
  }
}
