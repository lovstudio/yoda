import { describe, expect, it } from 'vitest';
import { formatLocalDateKey } from '../local-date';
import { parseCodexUsage } from './codex-usage-reader';

const DAY_ONE = '2026-03-01T12:00:00.000Z';
const DAY_TWO = '2026-03-03T12:00:00.000Z';

function tokenCountRow(total: Record<string, number> | null, timestamp: string = DAY_ONE): string {
  return JSON.stringify({
    type: 'event_msg',
    timestamp,
    payload: { type: 'token_count', info: total ? { total_token_usage: total } : null },
  });
}

describe('parseCodexUsage', () => {
  it('diffs cumulative totals so repeated mid-turn updates never double-count', () => {
    const raw = [
      tokenCountRow({ input_tokens: 100, cached_input_tokens: 40, output_tokens: 10 }),
      // Same cumulative counters repeated — no new burn.
      tokenCountRow({ input_tokens: 100, cached_input_tokens: 40, output_tokens: 10 }),
      tokenCountRow({
        input_tokens: 300,
        cached_input_tokens: 140,
        output_tokens: 30,
        reasoning_output_tokens: 8,
      }),
    ].join('\n');

    const usage = parseCodexUsage(raw);

    // cached_input_tokens is a subset of input_tokens — normalized out of `input`.
    expect(usage?.total).toEqual({
      input: 160,
      output: 30,
      cacheRead: 140,
      cacheCreation: 0,
      reasoning: 8,
      total: 330,
    });
  });

  it('buckets each delta by its event timestamp', () => {
    const raw = [
      tokenCountRow({ input_tokens: 100, output_tokens: 10 }, DAY_ONE),
      tokenCountRow({ input_tokens: 150, output_tokens: 25 }, DAY_TWO),
    ].join('\n');

    const usage = parseCodexUsage(raw);

    expect(usage?.daily).toEqual([
      {
        date: formatLocalDateKey(new Date(DAY_ONE)),
        tokens: {
          input: 100,
          output: 10,
          cacheRead: 0,
          cacheCreation: 0,
          reasoning: 0,
          total: 110,
        },
      },
      {
        date: formatLocalDateKey(new Date(DAY_TWO)),
        tokens: { input: 50, output: 15, cacheRead: 0, cacheCreation: 0, reasoning: 0, total: 65 },
      },
    ]);
  });

  it('treats a shrinking counter as a new baseline instead of going negative', () => {
    const raw = [
      tokenCountRow({ input_tokens: 1000, output_tokens: 100 }),
      // Compaction / fresh segment: cumulative counters restart.
      tokenCountRow({ input_tokens: 200, output_tokens: 20 }, DAY_TWO),
    ].join('\n');

    const usage = parseCodexUsage(raw);

    expect(usage?.total.input).toBe(1200);
    expect(usage?.total.output).toBe(120);
  });

  it('attributes deltas to the active turn_context model', () => {
    const turnContext = (model: string) =>
      JSON.stringify({ type: 'turn_context', timestamp: DAY_ONE, payload: { model } });
    const raw = [
      turnContext('gpt-5.3-codex'),
      tokenCountRow({ input_tokens: 100, output_tokens: 10 }),
      turnContext('gpt-5.3-codex-mini'),
      tokenCountRow({ input_tokens: 160, output_tokens: 16 }),
    ].join('\n');

    const usage = parseCodexUsage(raw);

    expect(usage?.byModel.map((m) => [m.model, m.tokens.total])).toEqual([
      ['gpt-5.3-codex', 110],
      ['gpt-5.3-codex-mini', 66],
    ]);
  });

  it('ignores info-less events and returns null when nothing counted', () => {
    const raw = [
      tokenCountRow(null),
      JSON.stringify({ type: 'event_msg', payload: { type: 'user_message', message: 'hi' } }),
      'not json',
    ].join('\n');

    expect(parseCodexUsage(raw)).toBeNull();
  });
});
