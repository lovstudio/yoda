import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readClaudeColdTurnVerdictFile } from './claude-cold-turn-verdict';

let directory: string;

function writeTranscript(name: string, rows: string[]): string {
  const path = join(directory, name);
  writeFileSync(path, `${rows.join('\n')}\n`);
  return path;
}

function row(value: Record<string, unknown>): string {
  return JSON.stringify(value);
}

const user = row({
  type: 'user',
  timestamp: '2026-08-01T00:00:00.000Z',
  message: { role: 'user', content: 'hello' },
});
const stop = row({ type: 'system', subtype: 'stop_hook_summary' });

describe('Claude cold turn verdict', () => {
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'yoda-claude-cold-turn-'));
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  it('derives idle from the newest completed turn without folding old payloads', async () => {
    const historicalPayload = row({
      type: 'assistant',
      message: { role: 'assistant', content: 'x'.repeat(512 * 1024) },
    });
    const path = writeTranscript('idle.jsonl', [historicalPayload, user, stop]);

    await expect(readClaudeColdTurnVerdictFile(path)).resolves.toMatchObject({ state: 'idle' });
  });

  it('preserves an unresolved interactive prompt as awaiting input', async () => {
    const ask = row({
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [{ type: 'tool_use', name: 'AskUserQuestion', id: 'question-1' }],
      },
    });
    const path = writeTranscript('awaiting.jsonl', [stop, user, ask]);

    await expect(readClaudeColdTurnVerdictFile(path)).resolves.toMatchObject({
      state: 'awaiting-input',
    });
  });

  it('fails closed when an oversized newest row makes the turn ambiguous', async () => {
    const oversized = row({
      type: 'assistant',
      message: { role: 'assistant', content: 'x'.repeat(2 * 1024 * 1024) },
    });
    const path = writeTranscript('ambiguous.jsonl', [user, stop, oversized]);

    await expect(readClaudeColdTurnVerdictFile(path)).resolves.toBeNull();
  });

  it('fails closed when the newest turn boundary exceeds the total scan budget', async () => {
    const irrelevant = row({
      type: 'assistant',
      message: { role: 'assistant', content: 'x'.repeat(1_000_000) },
    });
    const path = writeTranscript('over-budget.jsonl', [
      user,
      ...Array.from({ length: 9 }, () => irrelevant),
    ]);

    await expect(readClaudeColdTurnVerdictFile(path)).resolves.toBeNull();
  });

  it.each([
    ['empty', []],
    ['unrelated metadata', [row({ type: 'permission-mode' })]],
    ['stale completion without its user boundary', [stop]],
    ['malformed relevant row', ['{"type":"user"']],
    [
      'newly resumed but not flushed',
      [row({ type: 'assistant', message: { role: 'assistant', content: 'resuming' } })],
    ],
  ])('fails closed for %s transcripts without a complete turn boundary', async (_label, rows) => {
    const path = writeTranscript('incomplete.jsonl', rows);

    await expect(readClaudeColdTurnVerdictFile(path)).resolves.toBeNull();
  });
});
