import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getClaudeSessionContext } from './getClaudeSessionContext';

const mocks = vi.hoisted(() => ({
  resolveClaudeTranscriptPathFromConfigDir: vi.fn(() => ''),
  transcriptPath: '',
}));

vi.mock('@main/core/session-title/claude-title-source', () => ({
  encodeClaudeProjectDir: vi.fn(() => 'encoded-project'),
  resolveClaudeTranscriptPathFromConfigDir: mocks.resolveClaudeTranscriptPathFromConfigDir,
}));
vi.mock('./instruction-files', () => ({ getInstructionFiles: vi.fn(async () => []) }));
vi.mock('./scanClaudeAgents', () => ({ scanClaudeAgents: vi.fn(async () => []) }));
vi.mock('./scanClaudeSkills', () => ({ scanClaudeSkills: vi.fn(async () => []) }));

describe('getClaudeSessionContext restore checkpoints', () => {
  let directory: string;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'yoda-claude-context-'));
    mocks.transcriptPath = join(directory, 'session.jsonl');
    mocks.resolveClaudeTranscriptPathFromConfigDir.mockImplementation(() => mocks.transcriptPath);
  });

  afterEach(() => rmSync(directory, { recursive: true, force: true }));

  it('adds a completed-turn leaf target only to real user prompts', async () => {
    writeFileSync(
      mocks.transcriptPath,
      [
        row('user', 'prompt-1', null, { role: 'user', content: 'First prompt' }),
        row('assistant', 'answer-1', 'prompt-1', {
          role: 'assistant',
          content: [{ type: 'text', text: 'First answer' }],
        }),
        {
          type: 'system',
          subtype: 'turn_duration',
          uuid: 'done-1',
          parentUuid: 'answer-1',
        },
        row('user', 'notification-1', 'done-1', {
          role: 'user',
          content: '<task-notification>background task finished</task-notification>',
        }),
        row('user', 'prompt-2', 'notification-1', {
          role: 'user',
          content: 'Second prompt',
        }),
        row('assistant', 'answer-2', 'prompt-2', {
          role: 'assistant',
          content: [{ type: 'text', text: 'Still running' }],
        }),
      ]
        .map((value) => JSON.stringify(value))
        .join('\n'),
      'utf8'
    );

    const context = await getClaudeSessionContext('/repo', 'session-1', {
      claudeConfigDir: directory,
    });

    expect(mocks.resolveClaudeTranscriptPathFromConfigDir).toHaveBeenCalledWith(
      '/repo',
      'session-1',
      directory
    );

    expect(context?.prompts).toEqual([
      {
        id: 'prompt-1',
        text: 'First prompt',
        timestamp: null,
        restoreTarget: { kind: 'claude-message', messageId: 'done-1' },
      },
      { id: 'prompt-2', text: 'Second prompt', timestamp: null },
    ]);
    expect(context?.messages.filter((message) => message.role === 'user')).toEqual([
      { id: 'prompt-1', role: 'user', text: 'First prompt', timestamp: null },
      { id: 'prompt-2', role: 'user', text: 'Second prompt', timestamp: null },
    ]);
  });
});

function row(
  type: 'user' | 'assistant',
  uuid: string,
  parentUuid: string | null,
  message: Record<string, unknown>
): Record<string, unknown> {
  return { type, uuid, parentUuid, isSidechain: false, message };
}
