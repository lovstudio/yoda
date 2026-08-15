import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { encodeClaudeProjectDir } from '@main/core/session-title/claude-title-source';
import { formatLocalDateKey } from '../local-date';
import { claudeUsageReader, parseClaudeUsage, parseClaudeUsageLines } from './claude-usage-reader';

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
  it('uses the persisted provider session id and state root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'yoda-claude-usage-source-'));
    const cwd = '/workspace/from-provider';
    const projectDir = join(root, 'projects', encodeClaudeProjectDir(cwd));
    const transcriptPath = join(projectDir, 'provider-session.jsonl');
    await mkdir(projectDir, { recursive: true });
    await writeFile(transcriptPath, '', 'utf8');

    try {
      await expect(
        claudeUsageReader.resolveTranscriptPaths({
          cwd,
          conversationId: 'yoda-conversation',
          providerSessionId: 'provider-session',
          providerStateRoot: root,
        })
      ).resolves.toEqual([transcriptPath]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('preserves usage semantics when transcript lines arrive asynchronously', async () => {
    const lines = [
      assistantRow('msg-1', { input_tokens: 100, output_tokens: 50 }),
      assistantRow('msg-2', { input_tokens: 10, output_tokens: 5 }),
    ];
    async function* stream() {
      for (const row of lines) yield row;
    }

    await expect(parseClaudeUsageLines(stream())).resolves.toEqual(
      parseClaudeUsage(lines.join('\n'))
    );
  });

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

describe('parseClaudeUsage context window', () => {
  it('reads live context from the newest assistant message', () => {
    const raw = [
      assistantRow('msg-1', { input_tokens: 100, output_tokens: 50 }, DAY_ONE, 'claude-opus-5'),
      assistantRow(
        'msg-2',
        {
          input_tokens: 1_000,
          output_tokens: 2_000,
          cache_read_input_tokens: 40_000,
          cache_creation_input_tokens: 3_000,
        },
        DAY_ONE,
        'claude-opus-5'
      ),
    ].join('\n');

    expect(parseClaudeUsage(raw)?.context).toEqual({
      usedTokens: 46_000,
      limitTokens: 200_000,
      resetCount: 0,
      lastResetAt: null,
      rateLimits: [],
    });
  });

  it('promotes the window to 1M once the session outgrows the standard one', () => {
    const raw = assistantRow(
      'msg-1',
      { input_tokens: 1_000, cache_read_input_tokens: 300_000, output_tokens: 500 },
      DAY_ONE,
      'anthropic/claude-opus-5'
    );

    expect(parseClaudeUsage(raw)?.context).toMatchObject({
      usedTokens: 301_500,
      limitTokens: 1_000_000,
    });
  });

  it('counts compact boundaries and drops back to the post-compaction size', () => {
    const raw = [
      assistantRow(
        'msg-1',
        { input_tokens: 1_000, cache_read_input_tokens: 160_000 },
        DAY_ONE,
        'claude-opus-5'
      ),
      JSON.stringify({
        type: 'system',
        subtype: 'compact_boundary',
        timestamp: DAY_TWO,
        compactMetadata: { trigger: 'auto', preTokens: 161_000, postTokens: 18_000 },
      }),
    ].join('\n');

    expect(parseClaudeUsage(raw)?.context).toMatchObject({
      usedTokens: 18_000,
      resetCount: 1,
      lastResetAt: DAY_TWO,
    });
  });

  it('keeps the 1M window after compaction brings usage back down', () => {
    const raw = [
      JSON.stringify({
        type: 'system',
        subtype: 'compact_boundary',
        timestamp: DAY_ONE,
        compactMetadata: { trigger: 'auto', preTokens: 444_818, postTokens: 19_726 },
      }),
      assistantRow(
        'msg-1',
        { input_tokens: 1_000, cache_read_input_tokens: 120_000 },
        DAY_TWO,
        'claude-opus-5'
      ),
    ].join('\n');

    expect(parseClaudeUsage(raw)?.context).toMatchObject({
      usedTokens: 121_000,
      limitTokens: 1_000_000,
    });
  });

  it('ignores sidechain turns, which run on their own window', () => {
    const raw = [
      assistantRow(
        'msg-1',
        { input_tokens: 1_000, cache_read_input_tokens: 90_000 },
        DAY_ONE,
        'claude-opus-5'
      ),
      JSON.stringify({
        type: 'assistant',
        timestamp: DAY_ONE,
        isSidechain: true,
        message: { id: 'msg-sub', model: 'claude-opus-5', usage: { input_tokens: 500 } },
      }),
    ].join('\n');

    const usage = parseClaudeUsage(raw);

    expect(usage?.total.input).toBe(1_500);
    expect(usage?.context?.usedTokens).toBe(91_000);
  });
});
