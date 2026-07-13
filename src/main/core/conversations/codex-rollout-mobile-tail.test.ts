import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Conversation } from '@shared/conversations';
import {
  loadCodexRolloutTerminalHistoryTailForConversation,
  loadCodexRolloutTranscriptTailForConversation,
} from './codex-rollout-terminal-history';

const context = vi.hoisted(() => ({ rolloutPath: '' }));

vi.mock('./getCodexSessionContext', () => ({
  getCodexSessionContext: vi.fn(async () => ({
    rolloutPath: context.rolloutPath,
    threadId: 'thread-mobile-tail',
    title: 'Mobile tail test',
  })),
}));

const temporaryDirectories: string[] = [];

describe('bounded Codex rollout mobile readers', () => {
  afterEach(async () => {
    await Promise.all(
      temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true }))
    );
  });

  it('drops an oversized partial leading line and keeps recent messages and tools', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'yoda-mobile-rollout-tail-'));
    temporaryDirectories.push(directory);
    context.rolloutPath = path.join(directory, 'rollout.jsonl');
    const recentRows = [
      {
        timestamp: '2026-07-11T01:00:00.000Z',
        type: 'event_msg',
        payload: { type: 'agent_message', message: 'Recent assistant update' },
      },
      {
        timestamp: '2026-07-11T01:00:01.000Z',
        type: 'response_item',
        payload: {
          type: 'function_call',
          name: 'exec_command',
          call_id: 'call-recent',
          arguments: '{"cmd":"pnpm test"}',
        },
      },
      {
        timestamp: '2026-07-11T01:00:02.000Z',
        type: 'response_item',
        payload: {
          type: 'function_call_output',
          call_id: 'call-recent',
          output: 'All tests passed',
        },
      },
    ];
    await writeFile(
      context.rolloutPath,
      `${'x'.repeat(9 * 1024 * 1024)}\n${recentRows.map((row) => JSON.stringify(row)).join('\n')}\n`
    );
    const conversation = {
      id: 'conversation',
      runtimeId: 'codex',
      title: 'Conversation',
      createdAt: '2026-07-11T00:00:00.000Z',
    } as Conversation;

    const [transcript, history] = await Promise.all([
      loadCodexRolloutTranscriptTailForConversation({ conversation, cwd: directory }),
      loadCodexRolloutTerminalHistoryTailForConversation({ conversation, cwd: directory }),
    ]);

    expect(transcript).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: 'assistant', content: 'Recent assistant update' }),
        expect.objectContaining({
          role: 'tool',
          content: expect.stringContaining('All tests passed'),
        }),
      ])
    );
    expect(history).toContain('Recent assistant update');
    expect(history).toContain('All tests passed');
    expect(history).not.toContain('xxxxxxxx');
  });
});
