import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import {
  classifyCodexRollout,
  parseCodexRunStateEvent,
  parseTurnEvent,
  readCodexTurnVerdict,
  resolveCodexRolloutPathForConversation,
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

  it('prefers an explicit resumed thread over the most recently updated thread in the same cwd', () => {
    dir = mkdtempSync(join(tmpdir(), 'yoda-codex-run-state-'));
    const statePath = join(dir, 'state_5.sqlite');
    createStateDb(statePath);
    insertThread(statePath, {
      id: 'resumed-thread',
      cwd: '/shared-repo',
      rolloutPath: '/rollouts/resumed.jsonl',
      createdAtMs: Date.parse('2026-07-09T01:37:01.000Z'),
      updatedAtMs: Date.parse('2026-07-09T02:00:00.000Z'),
    });
    insertThread(statePath, {
      id: 'other-task-thread',
      cwd: '/shared-repo',
      rolloutPath: '/rollouts/other.jsonl',
      createdAtMs: Date.parse('2026-07-10T03:48:19.000Z'),
      updatedAtMs: Date.parse('2026-07-11T06:51:15.000Z'),
    });

    expect(
      resolveCodexRolloutPathForConversation({
        conversationId: 'yoda-conversation',
        cwd: '/shared-repo',
        startedAtMs: Date.parse('2026-07-11T07:00:00.000Z'),
        isResuming: true,
        threadId: 'resumed-thread',
        statePath,
      })
    ).toBe('/rollouts/resumed.jsonl');
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
