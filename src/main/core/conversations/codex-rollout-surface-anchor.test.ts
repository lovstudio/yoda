import { describe, expect, it, vi } from 'vitest';
import { parseCodexRolloutSurfaceAnchor } from './codex-rollout-terminal-history';

vi.mock('./agent-session-runtime', () => ({
  agentSessionRuntimeStore: {
    getStatus: vi.fn(() => 'idle'),
    isProviderTurnConfirmed: vi.fn(() => false),
  },
}));

function event(payload: Record<string, unknown>): string {
  return JSON.stringify({
    timestamp: '2026-08-14T00:00:00.000Z',
    type: 'event_msg',
    payload,
  });
}

describe('parseCodexRolloutSurfaceAnchor', () => {
  it('uses a provider-owned live-turn fence when the latest turn is unfinished', () => {
    const raw = [
      event({ type: 'task_started' }),
      event({ type: 'user_message', message: 'The prompt has already scrolled out of view' }),
      event({ type: 'agent_message', phase: 'commentary', message: 'Work is still in progress.' }),
    ].join('\n');

    expect(parseCodexRolloutSurfaceAnchor(raw)).toEqual({ kind: 'live-turn' });
  });

  it('keeps the completed final-answer anchor after the provider turn settles', () => {
    const raw = [
      event({ type: 'task_started' }),
      event({ type: 'user_message', message: 'Restore the completed provider surface' }),
      event({
        type: 'agent_message',
        phase: 'final_answer',
        message: 'The completed provider surface is ready and verified.',
      }),
      event({ type: 'task_complete' }),
    ].join('\n');

    expect(parseCodexRolloutSurfaceAnchor(raw)).toEqual({
      kind: 'anchor',
      segments: ['The completed provider surface is ready and verified.'],
    });
  });

  it('selects the latest completed assistant answer', () => {
    const raw = [
      event({ type: 'user_message', message: 'First request with enough visible evidence' }),
      event({ type: 'agent_message', phase: 'final_answer', message: 'First completed answer.' }),
      event({ type: 'user_message', message: 'Second request with enough visible evidence' }),
      event({ type: 'agent_message', phase: 'commentary', message: 'Still working on it.' }),
      event({
        type: 'agent_message',
        phase: 'final_answer',
        message: 'The latest durable answer is ready and verified.',
      }),
    ].join('\n');

    expect(parseCodexRolloutSurfaceAnchor(raw)).toEqual({
      kind: 'anchor',
      segments: ['The latest durable answer is ready and verified.'],
    });
  });

  it('falls back to the latest user message when no final answer is available', () => {
    const raw = [
      event({ type: 'user_message', message: 'An older request that should not be selected' }),
      event({ type: 'user_message', message: 'The newest user request is the durable evidence' }),
      event({ type: 'agent_message', phase: 'commentary', message: 'Work is still in progress.' }),
    ].join('\n');

    expect(parseCodexRolloutSurfaceAnchor(raw)).toEqual({
      kind: 'anchor',
      segments: ['The newest user request is the durable evidence'],
    });
  });

  it('does not reuse an old final answer for a newer unfinished user turn', () => {
    const raw = [
      event({ type: 'user_message', message: 'Finish the first durable request' }),
      event({
        type: 'agent_message',
        phase: 'final_answer',
        message: 'The first request is complete and verified.',
      }),
      event({
        type: 'user_message',
        message: 'This newer request is still waiting for its final answer',
      }),
    ].join('\n');

    expect(parseCodexRolloutSurfaceAnchor(raw)).toEqual({
      kind: 'anchor',
      segments: ['This newer request is still waiting for its final answer'],
    });
  });

  it('pairs a short final answer with its preceding user message in display order', () => {
    const raw = [
      event({
        type: 'user_message',
        message: 'Please verify the renderer surface before it becomes visible.',
      }),
      event({ type: 'agent_message', phase: 'final_answer', message: 'Done.' }),
    ].join('\n');

    expect(parseCodexRolloutSurfaceAnchor(raw)).toEqual({
      kind: 'anchor',
      segments: ['Please verify the renderer surface before it becomes visible.', 'Done.'],
    });
  });

  it('returns unverifiable when the bounded transcript has no reliable visible text', () => {
    const raw = [
      event({ type: 'user_message', message: '…' }),
      event({ type: 'agent_message', phase: 'final_answer', message: '✓' }),
    ].join('\n');

    expect(parseCodexRolloutSurfaceAnchor(raw)).toEqual({ kind: 'unverifiable' });
  });

  it('strictly bounds segment count and payload capacity', () => {
    const raw = [
      event({ type: 'user_message', message: `request-${'x'.repeat(400)}` }),
      event({ type: 'agent_message', phase: 'final_answer', message: 'OK' }),
    ].join('\n');

    const result = parseCodexRolloutSurfaceAnchor(raw);
    expect(result.kind).toBe('anchor');
    if (result.kind !== 'anchor') return;
    expect(result.segments).toHaveLength(2);
    expect(result.segments.every((segment) => segment.length <= 160)).toBe(true);
    expect(
      result.segments.reduce((total, segment) => total + segment.length, 0)
    ).toBeLessThanOrEqual(240);
  });

  it('projects Markdown to the text visible on the provider surface', () => {
    const raw = [
      event({ type: 'user_message', message: 'Please produce a Markdown result for this request' }),
      event({
        type: 'agent_message',
        phase: 'final_answer',
        message:
          '## Result\n\nOpen [the report](https://private.invalid/report) and <strong>review</strong> it.\n\n```ts\nconst ready = true;\n```',
      }),
    ].join('\n');

    expect(parseCodexRolloutSurfaceAnchor(raw)).toEqual({
      kind: 'anchor',
      segments: ['Result Open the report and review it. const ready = true;'],
    });
  });
});
