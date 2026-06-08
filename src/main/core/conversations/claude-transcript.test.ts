import { describe, expect, it } from 'vitest';
import { parseClaudeTranscript } from './claude-transcript';

describe('parseClaudeTranscript', () => {
  it('returns renderable user, assistant, and tool blocks without terminal UI noise', () => {
    const raw = [
      {
        uuid: 'user-1',
        timestamp: '2026-06-08T01:00:00.000Z',
        type: 'user',
        message: {
          role: 'user',
          content: [
            {
              type: 'text',
              text: '<system-reminder>hidden</system-reminder>Render this on mobile',
            },
          ],
        },
      },
      {
        uuid: 'assistant-1',
        timestamp: '2026-06-08T01:00:01.000Z',
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [
            {
              type: 'text',
              text: '## Result\n\n- Rendered Markdown',
            },
            {
              type: 'tool_use',
              name: 'Update',
              input: { file_path: 'src/example.tsx' },
            },
          ],
        },
      },
      {
        uuid: 'tool-result-1',
        timestamp: '2026-06-08T01:00:01.500Z',
        type: 'user',
        message: {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              content: 'Updated src/example.tsx',
            },
          ],
        },
      },
      {
        uuid: 'stop-1',
        timestamp: '2026-06-08T01:00:02.000Z',
        subtype: 'stop_hook_summary',
      },
    ]
      .map((row) => JSON.stringify(row))
      .join('\n');

    expect(parseClaudeTranscript(raw)).toEqual([
      {
        id: 'user-1-user-0',
        role: 'user',
        title: 'You',
        timestamp: '2026-06-08T01:00:00.000Z',
        format: 'markdown',
        content: 'Render this on mobile',
      },
      {
        id: 'assistant-1-assistant-1',
        role: 'assistant',
        title: 'Claude',
        timestamp: '2026-06-08T01:00:01.000Z',
        format: 'markdown',
        content: '## Result\n\n- Rendered Markdown',
      },
      {
        id: 'assistant-1-tool-2',
        role: 'tool',
        title: 'Tool · Update',
        timestamp: '2026-06-08T01:00:01.000Z',
        format: 'code',
        content: '{\n  "file_path": "src/example.tsx"\n}',
      },
      {
        id: 'tool-result-1-tool-3',
        role: 'tool',
        title: 'Tool output',
        timestamp: '2026-06-08T01:00:01.500Z',
        format: 'code',
        content: 'Updated src/example.tsx',
      },
    ]);
  });

  it('keeps streamed assistant text in one growing block until a tool boundary', () => {
    const raw = [
      {
        uuid: 'user-1',
        timestamp: '2026-06-08T01:00:00.000Z',
        type: 'user',
        message: {
          role: 'user',
          content: 'Implement this',
        },
      },
      {
        uuid: 'assistant-1',
        timestamp: '2026-06-08T01:00:01.000Z',
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'First paragraph.' }],
        },
      },
      {
        uuid: 'assistant-2',
        timestamp: '2026-06-08T01:00:02.000Z',
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'Second paragraph.' }],
        },
      },
      {
        uuid: 'assistant-tool',
        timestamp: '2026-06-08T01:00:03.000Z',
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [{ type: 'tool_use', name: 'Read', input: { file_path: 'a.ts' } }],
        },
      },
      {
        uuid: 'assistant-3',
        timestamp: '2026-06-08T01:00:04.000Z',
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'After tool.' }],
        },
      },
    ]
      .map((row) => JSON.stringify(row))
      .join('\n');

    expect(
      parseClaudeTranscript(raw).map((block) => [block.id, block.role, block.content])
    ).toEqual([
      ['user-1-user-0', 'user', 'Implement this'],
      ['assistant-1-assistant-1', 'assistant', 'First paragraph.\n\nSecond paragraph.'],
      ['assistant-tool-tool-3', 'tool', '{\n  "file_path": "a.ts"\n}'],
      ['assistant-3-assistant-4', 'assistant', 'After tool.'],
    ]);
  });
});
