import { describe, expect, it } from 'vitest';
import { parseTurnEvent } from './codex-run-state-source';

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
