import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getClaudeSessionContext,
  getClaudeSessionConversation,
  getClaudeSessionPrompts,
} from './getClaudeSessionContext';
import { getInstructionFiles } from './instruction-files';
import { scanClaudeAgents } from './scanClaudeAgents';
import { scanClaudeSkills } from './scanClaudeSkills';

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
    vi.clearAllMocks();
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
    const promptOnly = await getClaudeSessionPrompts('/repo', 'session-1', {
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
    expect(promptOnly).toEqual(context?.prompts);
    expect(context?.messages.filter((message) => message.role === 'user')).toEqual([
      { id: 'prompt-1', role: 'user', text: 'First prompt', timestamp: null },
      { id: 'prompt-2', role: 'user', text: 'Second prompt', timestamp: null },
    ]);
  });

  it('returns only the current parentUuid branch after a Claude rewind', async () => {
    writeFileSync(
      mocks.transcriptPath,
      [
        row('user', 'prompt-1', null, { role: 'user', content: 'Shared prompt' }),
        row('assistant', 'answer-1', 'prompt-1', {
          role: 'assistant',
          content: [{ type: 'text', text: 'Shared answer' }],
        }),
        doneRow('done-1', 'answer-1'),
        row('user', 'abandoned-prompt', 'done-1', {
          role: 'user',
          content: 'Prompt removed by Esc Esc',
        }),
        row('assistant', 'abandoned-answer', 'abandoned-prompt', {
          role: 'assistant',
          content: [{ type: 'text', text: 'Answer removed by Esc Esc' }],
        }),
        doneRow('abandoned-done', 'abandoned-answer'),
        row('user', 'current-prompt', 'done-1', {
          role: 'user',
          content: 'Prompt on the selected branch',
        }),
        row('assistant', 'current-answer', 'current-prompt', {
          role: 'assistant',
          content: [{ type: 'text', text: 'Answer on the selected branch' }],
        }),
        doneRow('current-done', 'current-answer'),
      ]
        .map((value) => JSON.stringify(value))
        .join('\n'),
      'utf8'
    );

    const context = await getClaudeSessionContext('/repo', 'session-1', {
      claudeConfigDir: directory,
    });

    expect(context?.prompts.map((prompt) => [prompt.id, prompt.restoreTarget])).toEqual([
      ['prompt-1', { kind: 'claude-message', messageId: 'done-1' }],
      ['current-prompt', { kind: 'claude-message', messageId: 'current-done' }],
    ]);
    expect(context?.messages.map((message) => message.text)).toEqual([
      'Shared prompt',
      'Shared answer',
      'Prompt on the selected branch',
      'Answer on the selected branch',
    ]);
  });

  it('keeps prompts from before a compaction and reports the boundary', async () => {
    writeFileSync(
      mocks.transcriptPath,
      [
        row('user', 'prompt-1', null, { role: 'user', content: 'Prompt before compaction' }),
        row('assistant', 'answer-1', 'prompt-1', {
          role: 'assistant',
          content: [{ type: 'text', text: 'Answer before compaction' }],
        }),
        doneRow('done-1', 'answer-1'),
        // Claude links a compaction boundary through logicalParentUuid only, so a
        // parentUuid-only walk stops here and hides everything above.
        {
          type: 'system',
          subtype: 'compact_boundary',
          uuid: 'boundary-1',
          parentUuid: null,
          logicalParentUuid: 'done-1',
          isSidechain: false,
          compactMetadata: { trigger: 'auto', preTokens: 166911, postTokens: 13638 },
        },
        {
          ...row('user', 'summary-1', 'boundary-1', {
            role: 'user',
            content: 'This session is being continued from a previous conversation…',
          }),
          isCompactSummary: true,
        },
        row('user', 'prompt-2', 'summary-1', { role: 'user', content: 'Prompt after compaction' }),
        row('assistant', 'answer-2', 'prompt-2', {
          role: 'assistant',
          content: [{ type: 'text', text: 'Answer after compaction' }],
        }),
        doneRow('done-2', 'answer-2'),
      ]
        .map((value) => JSON.stringify(value))
        .join('\n'),
      'utf8'
    );

    const context = await getClaudeSessionContext('/repo', 'session-1', {
      claudeConfigDir: directory,
    });

    expect(context?.prompts.map((prompt) => [prompt.id, prompt.restoreTarget])).toEqual([
      ['prompt-1', { kind: 'claude-message', messageId: 'done-1' }],
      ['prompt-2', { kind: 'claude-message', messageId: 'done-2' }],
    ]);
    expect(context?.compactions).toEqual([
      {
        afterPromptIndex: 1,
        timestamp: null,
        trigger: 'auto',
        preTokens: 166911,
        postTokens: 13638,
      },
    ]);
    expect(context?.summary?.text).toContain('continued from a previous conversation');
  });

  it('classifies Claude text before tools as commentary and end-turn text as final', async () => {
    writeFileSync(
      mocks.transcriptPath,
      [
        row('user', 'prompt-1', null, { role: 'user', content: 'Build it' }),
        row('assistant', 'commentary', 'prompt-1', {
          role: 'assistant',
          content: [{ type: 'text', text: 'I will inspect the code.' }],
          stop_reason: 'tool_use',
        }),
        row('assistant', 'final', 'commentary', {
          role: 'assistant',
          content: [{ type: 'text', text: 'Implemented and tested.' }],
          stop_reason: 'end_turn',
        }),
      ]
        .map((value) => JSON.stringify(value))
        .join('\n'),
      'utf8'
    );

    const context = await getClaudeSessionContext('/repo', 'session-1', {
      claudeConfigDir: directory,
    });

    expect(context?.messages.filter((message) => message.role === 'assistant')).toEqual([
      expect.objectContaining({ text: 'I will inspect the code.', phase: 'commentary' }),
      expect.objectContaining({ text: 'Implemented and tested.', phase: 'final' }),
    ]);
  });

  it('loads live conversation messages without scanning the Claude harness', async () => {
    writeFileSync(
      mocks.transcriptPath,
      [
        row('user', 'prompt-1', null, { role: 'user', content: 'Inspect the lag' }),
        {
          type: 'attachment',
          uuid: 'attachment-1',
          parentUuid: 'prompt-1',
          attachment: { type: 'deferred_tools_delta', addedNames: ['expensive_tool'] },
        },
        row('assistant', 'answer-1', 'attachment-1', {
          role: 'assistant',
          content: [{ type: 'text', text: 'The polling path is expensive.' }],
          stop_reason: 'end_turn',
        }),
      ]
        .map((value) => JSON.stringify(value))
        .join('\n'),
      'utf8'
    );

    const conversation = await getClaudeSessionConversation('/repo', 'session-1', {
      claudeConfigDir: directory,
    });

    expect(conversation?.prompts.map((prompt) => prompt.text)).toEqual(['Inspect the lag']);
    expect(conversation?.messages.map((message) => message.text)).toEqual([
      'Inspect the lag',
      'The polling path is expensive.',
    ]);
    expect(getInstructionFiles).not.toHaveBeenCalled();
    expect(scanClaudeSkills).not.toHaveBeenCalled();
    expect(scanClaudeAgents).not.toHaveBeenCalled();
  });
});

function doneRow(uuid: string, parentUuid: string): Record<string, unknown> {
  return { type: 'system', subtype: 'turn_duration', uuid, parentUuid, isSidechain: false };
}

function row(
  type: 'user' | 'assistant',
  uuid: string,
  parentUuid: string | null,
  message: Record<string, unknown>
): Record<string, unknown> {
  return { type, uuid, parentUuid, isSidechain: false, message };
}
