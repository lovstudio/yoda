import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  formatCodexRolloutTerminalHistory,
  loadCodexRolloutShareSourceForConversation,
  loadCodexRolloutTerminalHistoryForConversation,
  loadCodexRolloutTranscriptTailForConversation,
  parseCodexRolloutShareImages,
  parseCodexRolloutTranscript,
} from './codex-rollout-terminal-history';

const mocks = vi.hoisted(() => ({
  getReservedCodexThreadIds: vi.fn(async () => new Set<string>()),
}));

vi.mock('./codex-thread-reservations', () => ({
  getReservedCodexThreadIds: mocks.getReservedCodexThreadIds,
}));

vi.mock('./agent-session-runtime', () => ({
  agentSessionRuntimeStore: {
    getStatus: vi.fn(() => 'idle'),
    isProviderTurnConfirmed: vi.fn(() => false),
  },
}));

beforeEach(() => {
  mocks.getReservedCodexThreadIds.mockReset();
  mocks.getReservedCodexThreadIds.mockResolvedValue(new Set());
});

describe('formatCodexRolloutTerminalHistory', () => {
  it('formats Codex event messages and command output for terminal replay', () => {
    const raw = [
      {
        timestamp: '2026-06-04T01:00:00.000Z',
        type: 'event_msg',
        payload: {
          type: 'task_started',
        },
      },
      {
        timestamp: '2026-06-04T01:00:01.000Z',
        type: 'event_msg',
        payload: {
          type: 'user_message',
          message: 'Please inspect the project',
        },
      },
      {
        timestamp: '2026-06-04T01:00:02.000Z',
        type: 'event_msg',
        payload: {
          type: 'agent_message',
          message: 'I will read the relevant files first.',
        },
      },
      {
        timestamp: '2026-06-04T01:00:03.000Z',
        type: 'event_msg',
        payload: {
          type: 'exec_command_end',
          command: ['/bin/zsh', '-lc', 'pnpm test'],
          aggregated_output: 'Tests passed',
          status: 'completed',
          exit_code: 0,
        },
      },
      {
        timestamp: '2026-06-04T01:00:04.000Z',
        type: 'event_msg',
        payload: {
          type: 'task_complete',
        },
      },
    ]
      .map((row) => JSON.stringify(row))
      .join('\n');

    const history = formatCodexRolloutTerminalHistory(raw, {
      threadId: 'thread-1',
      title: 'Test thread',
      rolloutPath: '/tmp/rollout.jsonl',
    });

    expect(history).toContain('Codex history loaded from rollout transcript');
    expect(history).toContain('[Status 2026-06-04T01:00:00.000Z]\nTask started');
    expect(history).toContain('[User 2026-06-04T01:00:01.000Z]\nPlease inspect the project');
    expect(history).toContain(
      '[Codex 2026-06-04T01:00:02.000Z]\nI will read the relevant files first.'
    );
    expect(history).toContain("$ /bin/zsh -lc 'pnpm test'");
    expect(history).toContain('Tests passed');
    expect(history).toContain('[completed, exit 0]');
    expect(history).toContain('Task complete');
  });

  it('falls back to response items when event messages are unavailable', () => {
    const raw = [
      {
        timestamp: '2026-06-04T01:00:01.000Z',
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: 'Build the feature' }],
        },
      },
      {
        timestamp: '2026-06-04T01:00:02.000Z',
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: 'Implemented.' }],
        },
      },
      {
        timestamp: '2026-06-04T01:00:03.000Z',
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'developer',
          content: [{ type: 'input_text', text: 'Developer instructions' }],
        },
      },
    ]
      .map((row) => JSON.stringify(row))
      .join('\n');

    const history = formatCodexRolloutTerminalHistory(raw, {
      threadId: 'thread-1',
      title: 'Test thread',
      rolloutPath: '/tmp/rollout.jsonl',
    });

    expect(history).toContain('[User 2026-06-04T01:00:01.000Z]\nBuild the feature');
    expect(history).toContain('[Codex 2026-06-04T01:00:02.000Z]\nImplemented.');
    expect(history).not.toContain('Developer instructions');
  });

  it('keeps response tool activity when event messages provide the conversation text', () => {
    const raw = mixedModernRollout();

    const history = formatCodexRolloutTerminalHistory(raw, {
      threadId: 'thread-1',
      title: 'Test thread',
      rolloutPath: '/tmp/rollout.jsonl',
    });

    expect(history).toContain('[User 2026-06-04T01:00:01.000Z]\nBuild the feature');
    expect(history).toContain('[Codex 2026-06-04T01:00:02.000Z]\nI will update it.');
    expect(history).toContain('[Run command 2026-06-04T01:00:03.000Z]');
    expect(history).toContain('Script completed');
    expect(history).toContain('[Image output omitted]');
    expect(history).toContain('[Start sub-agent 2026-06-04T01:00:05.000Z]');
    expect(history).not.toContain('Duplicate response text');
    expect(history).not.toContain('Patch fallback should be hidden');
  });

  it('loads terminal replay from the latest rewind fork of a discovered session', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'yoda-codex-terminal-lineage-'));
    const statePath = join(directory, 'state_5.sqlite');
    const rootRolloutPath = join(directory, 'root.jsonl');
    const forkedRolloutPath = join(directory, 'forked.jsonl');

    try {
      createStateDb(statePath);
      writeFileSync(
        rootRolloutPath,
        [
          {
            timestamp: '2026-08-01T01:57:02.000Z',
            type: 'session_meta',
            payload: { id: 'root-thread', cwd: '/repo' },
          },
          {
            timestamp: '2026-08-01T02:23:20.000Z',
            type: 'event_msg',
            payload: { type: 'agent_message', message: 'Stale root ending' },
          },
        ]
          .map((row) => JSON.stringify(row))
          .join('\n')
      );
      writeFileSync(
        forkedRolloutPath,
        [
          {
            timestamp: '2026-08-01T02:23:22.000Z',
            type: 'session_meta',
            payload: {
              id: 'forked-thread',
              forked_from_id: 'root-thread',
              cwd: '/repo',
            },
          },
          {
            timestamp: '2026-08-01T02:59:38.000Z',
            type: 'event_msg',
            payload: { type: 'agent_message', message: 'Latest continuation content' },
          },
        ]
          .map((row) => JSON.stringify(row))
          .join('\n')
      );
      insertThread(statePath, {
        id: 'root-thread',
        rolloutPath: rootRolloutPath,
        createdAtMs: Date.parse('2026-08-01T01:57:02.000Z'),
        updatedAtMs: Date.parse('2026-08-01T02:23:20.000Z'),
      });
      insertThread(statePath, {
        id: 'forked-thread',
        rolloutPath: forkedRolloutPath,
        createdAtMs: Date.parse('2026-08-01T02:23:22.000Z'),
        updatedAtMs: Date.parse('2026-08-01T03:01:19.000Z'),
      });

      const history = await loadCodexRolloutTerminalHistoryForConversation({
        cwd: '/repo',
        conversation: {
          id: 'yoda-conversation',
          projectId: 'project-1',
          taskId: 'task-1',
          runtimeId: 'codex',
          title: 'Discovered session',
          createdAt: '2026-08-01 01:57:02',
          lastInteractedAt: '2026-08-01T02:39:59.000Z',
          isInitialConversation: true,
          sessionSource: {
            catalogId: 'catalog-1',
            runtimeId: 'codex',
            sessionId: 'root-thread',
            stateRoot: directory,
          },
        },
      });

      expect(history).toContain('Thread: forked-thread');
      expect(history).toContain('Latest continuation content');
      expect(history).not.toContain('Stale root ending');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('keeps mobile transcript reads on the selected session when a fork is another session', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'yoda-codex-mobile-session-scope-'));
    const statePath = join(directory, 'state_5.sqlite');
    const rootRolloutPath = join(directory, 'root.jsonl');
    const siblingRolloutPath = join(directory, 'sibling.jsonl');

    try {
      createStateDb(statePath);
      writeFileSync(
        rootRolloutPath,
        [
          {
            timestamp: '2026-08-05T04:44:34.000Z',
            type: 'session_meta',
            payload: { id: 'root-thread', cwd: '/repo' },
          },
          {
            timestamp: '2026-08-05T05:00:00.000Z',
            type: 'event_msg',
            payload: { type: 'agent_message', message: 'Selected session content' },
          },
        ]
          .map((row) => JSON.stringify(row))
          .join('\n')
      );
      writeFileSync(
        siblingRolloutPath,
        [
          {
            timestamp: '2026-08-05T06:21:33.000Z',
            type: 'session_meta',
            payload: {
              id: 'sibling-thread',
              forked_from_id: 'root-thread',
              cwd: '/repo',
            },
          },
          {
            timestamp: '2026-08-05T06:23:14.000Z',
            type: 'event_msg',
            payload: { type: 'agent_message', message: 'Other session content' },
          },
        ]
          .map((row) => JSON.stringify(row))
          .join('\n')
      );
      insertThread(statePath, {
        id: 'root-thread',
        rolloutPath: rootRolloutPath,
        createdAtMs: Date.parse('2026-08-05T04:44:34.000Z'),
        updatedAtMs: Date.parse('2026-08-05T05:00:00.000Z'),
      });
      insertThread(statePath, {
        id: 'sibling-thread',
        rolloutPath: siblingRolloutPath,
        createdAtMs: Date.parse('2026-08-05T06:21:33.000Z'),
        updatedAtMs: Date.parse('2026-08-05T06:23:14.000Z'),
      });
      mocks.getReservedCodexThreadIds.mockResolvedValue(new Set(['sibling-thread']));

      const transcript = await loadCodexRolloutTranscriptTailForConversation({
        cwd: '/repo',
        conversation: {
          id: 'selected-conversation',
          projectId: 'project-1',
          taskId: 'task-1',
          runtimeId: 'codex',
          title: 'Discovered session',
          createdAt: '2026-08-05 04:44:34',
          lastInteractedAt: '2026-08-05T05:00:00.000Z',
          isInitialConversation: true,
          sessionSource: {
            catalogId: 'catalog-1',
            runtimeId: 'codex',
            sessionId: 'root-thread',
            stateRoot: directory,
          },
        },
      });

      expect(transcript?.map((entry) => entry.content)).toContain('Selected session content');
      expect(transcript?.map((entry) => entry.content)).not.toContain('Other session content');
      expect(mocks.getReservedCodexThreadIds).toHaveBeenCalledWith('selected-conversation');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('shares the whole rollout even past the bound mobile reads stop at', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'yoda-codex-share-full-history-'));
    const statePath = join(directory, 'state_5.sqlite');
    const rolloutPath = join(directory, 'rollout.jsonl');
    const conversation = {
      id: 'shared-conversation',
      projectId: 'project-1',
      taskId: 'task-1',
      runtimeId: 'codex' as const,
      title: 'Long session',
      createdAt: '2026-08-10 01:00:00',
      lastInteractedAt: '2026-08-10T02:00:00.000Z',
      isInitialConversation: true,
      sessionSource: {
        catalogId: 'catalog-1',
        runtimeId: 'codex' as const,
        sessionId: 'long-thread',
        stateRoot: directory,
      },
    };

    try {
      createStateDb(statePath);
      // Filler pushes the opening turn beyond the 8 MiB tail every mobile read
      // is bounded to, which is what used to cut a shared session's history.
      const filler = 'x'.repeat(64 * 1024);
      writeFileSync(
        rolloutPath,
        [
          {
            timestamp: '2026-08-10T01:00:00.000Z',
            type: 'session_meta',
            payload: { id: 'long-thread', cwd: '/repo' },
          },
          {
            timestamp: '2026-08-10T01:00:01.000Z',
            type: 'event_msg',
            payload: { type: 'user_message', message: 'Opening turn' },
          },
          ...Array.from({ length: 160 }, (_, index) => ({
            timestamp: '2026-08-10T01:30:00.000Z',
            type: 'event_msg',
            payload: { type: 'agent_message', message: `${index} ${filler}` },
          })),
          {
            timestamp: '2026-08-10T02:00:00.000Z',
            type: 'event_msg',
            payload: { type: 'agent_message', message: 'Closing turn' },
          },
        ]
          .map((row) => JSON.stringify(row))
          .join('\n')
      );
      insertThread(statePath, {
        id: 'long-thread',
        rolloutPath,
        createdAtMs: Date.parse('2026-08-10T01:00:00.000Z'),
        updatedAtMs: Date.parse('2026-08-10T02:00:00.000Z'),
      });

      const tail = await loadCodexRolloutTranscriptTailForConversation({
        cwd: '/repo',
        conversation,
      });
      expect(tail?.map((entry) => entry.content)).not.toContain('Opening turn');

      const share = await loadCodexRolloutShareSourceForConversation({
        cwd: '/repo',
        conversation,
      });
      const contents = share.transcript.map((entry) => entry.content);
      expect(contents).toContain('Opening turn');
      // Consecutive agent messages fold into one block, so the closing turn is
      // the tail of the last one rather than an entry of its own.
      expect(contents.at(-1)?.endsWith('Closing turn')).toBe(true);
      expect(share.truncated).toBe(false);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

describe('parseCodexRolloutTranscript', () => {
  it('keeps embedded user images recoverable for public sharing', () => {
    const imageData = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ';
    const raw = [
      {
        timestamp: '2026-07-29T05:40:33.120Z',
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: '<image name=[Image #1] path="/tmp/source.png">',
            },
            {
              type: 'input_image',
              image_url: `data:image/png;base64,${imageData}`,
            },
            { type: 'input_text', text: '</image>' },
            {
              type: 'input_text',
              text: '[Image #1] 那个 P 图汇总图应该上传',
            },
          ],
        },
      },
      {
        timestamp: '2026-07-29T05:40:33.121Z',
        type: 'event_msg',
        payload: {
          type: 'user_message',
          message: '[Image #1] 那个 P 图汇总图应该上传',
        },
      },
    ]
      .map((row) => JSON.stringify(row))
      .join('\n');

    expect(parseCodexRolloutShareImages(raw)).toEqual([
      {
        timestamp: '2026-07-29T05:40:33.120Z',
        message: '[Image #1] 那个 P 图汇总图应该上传',
        images: [
          {
            label: 'Image #1',
            contentType: 'image/png',
            dataBase64: imageData,
          },
        ],
      },
    ]);
    expect(parseCodexRolloutTranscript(raw)[0]?.content).toBe('[Image #1] 那个 P 图汇总图应该上传');
  });

  it('returns structured renderable transcript blocks from event messages', () => {
    const raw = [
      {
        timestamp: '2026-06-04T01:00:01.000Z',
        type: 'event_msg',
        payload: {
          type: 'user_message',
          message: 'Please summarize **this**',
        },
      },
      {
        timestamp: '2026-06-04T01:00:02.000Z',
        type: 'event_msg',
        payload: {
          type: 'agent_message',
          message: '## Summary\n\n- Done',
        },
      },
      {
        timestamp: '2026-06-04T01:00:03.000Z',
        type: 'event_msg',
        payload: {
          type: 'exec_command_end',
          command: ['pnpm', 'test'],
          aggregated_output: 'Tests passed',
          status: 'completed',
          exit_code: 0,
        },
      },
    ]
      .map((row) => JSON.stringify(row))
      .join('\n');

    expect(parseCodexRolloutTranscript(raw)).toEqual([
      {
        id: '2026-06-04T01:00:01.000Z-user-0',
        timestamp: '2026-06-04T01:00:01.000Z',
        role: 'user',
        title: 'You',
        format: 'markdown',
        content: 'Please summarize **this**',
      },
      {
        id: '2026-06-04T01:00:02.000Z-assistant-1',
        timestamp: '2026-06-04T01:00:02.000Z',
        role: 'assistant',
        title: 'Codex',
        format: 'markdown',
        content: '## Summary\n\n- Done',
      },
      {
        id: '2026-06-04T01:00:03.000Z-tool-2',
        timestamp: '2026-06-04T01:00:03.000Z',
        role: 'tool',
        toolStatus: 'completed',
        title: 'Command',
        format: 'code',
        content: '$ pnpm test\nTests passed\n[completed, exit 0]',
      },
    ]);
  });

  it('keeps consecutive Codex agent messages in one assistant block', () => {
    const raw = [
      {
        timestamp: '2026-06-04T01:00:01.000Z',
        type: 'event_msg',
        payload: {
          type: 'user_message',
          message: 'Build it',
        },
      },
      {
        timestamp: '2026-06-04T01:00:02.000Z',
        type: 'event_msg',
        payload: {
          type: 'agent_message',
          message: 'First part.',
        },
      },
      {
        timestamp: '2026-06-04T01:00:03.000Z',
        type: 'event_msg',
        payload: {
          type: 'agent_message',
          message: 'Second part.',
        },
      },
      {
        timestamp: '2026-06-04T01:00:04.000Z',
        type: 'event_msg',
        payload: {
          type: 'exec_command_end',
          command: 'pnpm test',
          aggregated_output: 'ok',
        },
      },
      {
        timestamp: '2026-06-04T01:00:05.000Z',
        type: 'event_msg',
        payload: {
          type: 'agent_message',
          message: 'After command.',
        },
      },
    ]
      .map((row) => JSON.stringify(row))
      .join('\n');

    expect(
      parseCodexRolloutTranscript(raw).map((block) => [block.id, block.role, block.content])
    ).toEqual([
      ['2026-06-04T01:00:01.000Z-user-0', 'user', 'Build it'],
      ['2026-06-04T01:00:02.000Z-assistant-1', 'assistant', 'First part.\n\nSecond part.'],
      ['2026-06-04T01:00:04.000Z-tool-3', 'tool', '$ pnpm test\nok'],
      ['2026-06-04T01:00:05.000Z-assistant-4', 'assistant', 'After command.'],
    ]);
  });

  it('keeps commentary and final Codex replies in separate phase-tagged blocks', () => {
    const raw = [
      {
        timestamp: '2026-06-04T01:00:01.000Z',
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'assistant',
          phase: 'commentary',
          content: [{ type: 'output_text', text: 'I will inspect the code.' }],
        },
      },
      {
        timestamp: '2026-06-04T01:00:02.000Z',
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'assistant',
          phase: 'final_answer',
          content: [{ type: 'output_text', text: 'Implemented and tested.' }],
        },
      },
    ]
      .map((row) => JSON.stringify(row))
      .join('\n');

    expect(
      parseCodexRolloutTranscript(raw).map((block) => [block.agentPhase, block.content])
    ).toEqual([
      ['commentary', 'I will inspect the code.'],
      ['final', 'Implemented and tested.'],
    ]);
  });

  it('merges modern tool calls into the event transcript in stable source order', () => {
    const blocks = parseCodexRolloutTranscript(mixedModernRollout());

    expect(blocks.map((block) => [block.id, block.role, block.title])).toEqual([
      ['2026-06-04T01:00:01.000Z-user-0', 'user', 'You'],
      ['2026-06-04T01:00:02.000Z-assistant-2', 'assistant', 'Codex'],
      ['2026-06-04T01:00:03.000Z-tool-3', 'tool', 'Run command'],
      ['2026-06-04T01:00:05.000Z-tool-5', 'tool', 'Start sub-agent'],
      ['2026-06-04T01:00:08.000Z-assistant-8', 'assistant', 'Codex'],
    ]);
    expect(blocks[2]?.content).toContain('tools.exec_command');
    expect(blocks[2]?.toolStatus).toBe('completed');
    expect(blocks[2]?.content).toContain('Output:\nScript completed');
    expect(blocks[2]?.content).toContain('[Image output omitted]');
    expect(blocks[3]?.content).toContain('Output:\nSub-agent started');
    expect(blocks.some((block) => block.content.includes('Duplicate response text'))).toBe(false);
    expect(blocks.some((block) => block.content.includes('Patch fallback should be hidden'))).toBe(
      false
    );
  });

  it('keeps a pending tool call visible before its output arrives', () => {
    const prefix = mixedModernRollout().split('\n').slice(0, 4).join('\n');
    const [user, assistant, tool] = parseCodexRolloutTranscript(prefix);

    expect(user?.role).toBe('user');
    expect(assistant?.role).toBe('assistant');
    expect(tool).toMatchObject({
      id: '2026-06-04T01:00:03.000Z-tool-3',
      role: 'tool',
      toolStatus: 'running',
      title: 'Run command',
    });
    expect(tool?.content).not.toContain('Output:');
  });

  it('completes a tool call even when the tool returns an empty payload', () => {
    const raw = [
      {
        timestamp: '2026-06-04T01:00:03.000Z',
        type: 'response_item',
        payload: {
          type: 'function_call',
          name: 'exec_command',
          call_id: 'call-empty',
          arguments: '{"cmd":"true"}',
        },
      },
      {
        timestamp: '2026-06-04T01:00:04.000Z',
        type: 'response_item',
        payload: {
          type: 'function_call_output',
          call_id: 'call-empty',
          output: '',
        },
      },
    ]
      .map((row) => JSON.stringify(row))
      .join('\n');

    expect(parseCodexRolloutTranscript(raw)[0]).toMatchObject({
      role: 'tool',
      toolStatus: 'completed',
      content: '{"cmd":"true"}\n\nOutput:\nCompleted with no output.',
    });
  });
});

function mixedModernRollout(): string {
  return [
    {
      timestamp: '2026-06-04T01:00:01.000Z',
      type: 'event_msg',
      payload: { type: 'user_message', message: 'Build the feature' },
    },
    {
      timestamp: '2026-06-04T01:00:01.100Z',
      type: 'response_item',
      payload: {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: 'Duplicate response text' }],
      },
    },
    {
      timestamp: '2026-06-04T01:00:02.000Z',
      type: 'event_msg',
      payload: { type: 'agent_message', message: 'I will update it.' },
    },
    {
      timestamp: '2026-06-04T01:00:03.000Z',
      type: 'response_item',
      payload: {
        type: 'custom_tool_call',
        name: 'exec',
        call_id: 'call-command',
        input: 'const r = await tools.exec_command({"cmd":"pnpm test"});',
      },
    },
    {
      timestamp: '2026-06-04T01:00:04.000Z',
      type: 'response_item',
      payload: {
        type: 'custom_tool_call_output',
        call_id: 'call-command',
        output: [
          { type: 'input_text', text: 'Script completed\nTests passed' },
          { type: 'input_image', image_url: 'data:image/png;base64,omitted' },
        ],
      },
    },
    {
      timestamp: '2026-06-04T01:00:05.000Z',
      type: 'response_item',
      payload: {
        type: 'function_call',
        name: 'spawn_agent',
        call_id: 'call-agent',
        arguments: '{"task_name":"review"}',
      },
    },
    {
      timestamp: '2026-06-04T01:00:06.000Z',
      type: 'response_item',
      payload: {
        type: 'function_call_output',
        call_id: 'call-agent',
        output: 'Sub-agent started',
      },
    },
    {
      timestamp: '2026-06-04T01:00:07.000Z',
      type: 'event_msg',
      payload: {
        type: 'patch_apply_end',
        stdout: 'Patch fallback should be hidden',
        success: true,
      },
    },
    {
      timestamp: '2026-06-04T01:00:08.000Z',
      type: 'event_msg',
      payload: { type: 'agent_message', message: 'Done.' },
    },
  ]
    .map((row) => JSON.stringify(row))
    .join('\n');
}

function createStateDb(statePath: string): void {
  const db = new Database(statePath);
  try {
    db.exec(`
      CREATE TABLE threads (
        id TEXT PRIMARY KEY,
        rollout_path TEXT NOT NULL DEFAULT '',
        cwd TEXT NOT NULL,
        title TEXT NOT NULL,
        first_user_message TEXT NOT NULL DEFAULT '',
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
  args: { id: string; rolloutPath: string; createdAtMs: number; updatedAtMs: number }
): void {
  const db = new Database(statePath);
  try {
    db.prepare(
      `
        INSERT INTO threads (
          id,
          rollout_path,
          cwd,
          title,
          first_user_message,
          created_at,
          updated_at,
          created_at_ms,
          updated_at_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
    ).run(
      args.id,
      args.rolloutPath,
      '/repo',
      'Discovered session',
      'Discovered session',
      Math.floor(args.createdAtMs / 1000),
      Math.floor(args.updatedAtMs / 1000),
      args.createdAtMs,
      args.updatedAtMs
    );
  } finally {
    db.close();
  }
}
