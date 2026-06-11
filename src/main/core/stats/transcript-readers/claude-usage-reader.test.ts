import { describe, expect, it } from 'vitest';
import { formatLocalDateKey } from '../local-date';
import { parseClaudeUsage } from './claude-usage-reader';

const DAY_ONE = '2026-03-01T12:00:00.000Z';
const DAY_TWO = '2026-03-03T12:00:00.000Z';

function assistantRow(
  messageId: string,
  usage: Record<string, number>,
  timestamp: string = DAY_ONE,
  model?: string
): string {
  return JSON.stringify({
    type: 'assistant',
    timestamp,
    message: { id: messageId, usage, ...(model ? { model } : {}) },
  });
}

describe('parseClaudeUsage', () => {
  it('aggregates usage across assistant messages', () => {
    const raw = [
      JSON.stringify({ type: 'user', message: { content: 'hi' } }),
      assistantRow('msg-1', {
        input_tokens: 100,
        output_tokens: 50,
        cache_read_input_tokens: 1000,
        cache_creation_input_tokens: 200,
      }),
      assistantRow('msg-2', { input_tokens: 10, output_tokens: 5 }),
    ].join('\n');

    const usage = parseClaudeUsage(raw);

    expect(usage?.total).toEqual({
      input: 110,
      output: 55,
      cacheRead: 1000,
      cacheCreation: 200,
      reasoning: 0,
      total: 1365,
    });
  });

  it('dedupes repeated rows of the same message id, last row wins', () => {
    const raw = [
      assistantRow('msg-1', { input_tokens: 100, output_tokens: 10 }),
      assistantRow('msg-1', { input_tokens: 100, output_tokens: 40 }),
    ].join('\n');

    const usage = parseClaudeUsage(raw);

    expect(usage?.total.input).toBe(100);
    expect(usage?.total.output).toBe(40);
  });

  it('buckets usage by local date of the row timestamp', () => {
    const raw = [
      assistantRow('msg-1', { input_tokens: 1, output_tokens: 2 }, DAY_ONE),
      assistantRow('msg-2', { input_tokens: 3, output_tokens: 4 }, DAY_TWO),
      assistantRow('msg-3', { input_tokens: 5, output_tokens: 6 }, DAY_TWO),
    ].join('\n');

    const usage = parseClaudeUsage(raw);

    expect(usage?.daily).toEqual([
      {
        date: formatLocalDateKey(new Date(DAY_ONE)),
        tokens: { input: 1, output: 2, cacheRead: 0, cacheCreation: 0, reasoning: 0, total: 3 },
      },
      {
        date: formatLocalDateKey(new Date(DAY_TWO)),
        tokens: { input: 8, output: 10, cacheRead: 0, cacheCreation: 0, reasoning: 0, total: 18 },
      },
    ]);
  });

  it('attributes usage to message.model, mapping <synthetic> to null', () => {
    const raw = [
      assistantRow('msg-1', { input_tokens: 10, output_tokens: 1 }, DAY_ONE, 'claude-opus-4-8'),
      assistantRow('msg-2', { input_tokens: 20, output_tokens: 2 }, DAY_ONE, 'claude-opus-4-8'),
      assistantRow('msg-3', { input_tokens: 5, output_tokens: 1 }, DAY_ONE, 'claude-haiku-4-5'),
      assistantRow('msg-4', { input_tokens: 0, output_tokens: 1 }, DAY_ONE, '<synthetic>'),
    ].join('\n');

    const usage = parseClaudeUsage(raw);

    expect(usage?.byModel.map((m) => [m.model, m.tokens.total])).toEqual([
      ['claude-opus-4-8', 33],
      ['claude-haiku-4-5', 6],
      [null, 1],
    ]);
  });

  it('returns null when no assistant rows carry usage', () => {
    const raw = [
      JSON.stringify({ type: 'user', message: { content: 'hi' } }),
      JSON.stringify({ type: 'assistant', message: { id: 'msg-1' } }),
      'not json',
    ].join('\n');

    expect(parseClaudeUsage(raw)).toBeNull();
  });
});
