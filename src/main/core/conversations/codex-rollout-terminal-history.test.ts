import { describe, expect, it } from 'vitest';
import {
  formatCodexRolloutTerminalHistory,
  parseCodexRolloutTranscript,
} from './codex-rollout-terminal-history';

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
});

describe('parseCodexRolloutTranscript', () => {
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
      title: 'Run command',
    });
    expect(tool?.content).not.toContain('Output:');
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
