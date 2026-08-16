import { appendFile, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ClaudeTranscriptReader, parseClaudeTranscript } from './claude-transcript';

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
          stop_reason: 'tool_use',
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
        // The turn ends on a tool call, so its last reply is promoted to `final`
        // and the turn still shows up at the concise display level.
        agentPhase: 'final',
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

  it('keeps commentary and final Claude replies in separate phase-tagged blocks', () => {
    const raw = [
      {
        uuid: 'assistant-commentary',
        timestamp: '2026-06-08T01:00:01.000Z',
        type: 'assistant',
        message: {
          role: 'assistant',
          stop_reason: 'tool_use',
          content: 'I will inspect the code.',
        },
      },
      {
        uuid: 'assistant-final',
        timestamp: '2026-06-08T01:00:02.000Z',
        type: 'assistant',
        message: {
          role: 'assistant',
          stop_reason: 'end_turn',
          content: 'Implemented and tested.',
        },
      },
    ]
      .map((row) => JSON.stringify(row))
      .join('\n');

    expect(parseClaudeTranscript(raw).map((block) => [block.agentPhase, block.content])).toEqual([
      ['commentary', 'I will inspect the code.'],
      ['final', 'Implemented and tested.'],
    ]);
  });

  it('marks an unanswered interactive tool call as running and pairs its result', () => {
    const question = {
      uuid: 'assistant-question',
      timestamp: '2026-06-08T01:00:01.000Z',
      type: 'assistant',
      message: {
        role: 'assistant',
        stop_reason: 'tool_use',
        content: [
          {
            type: 'tool_use',
            id: 'question-1',
            name: 'AskUserQuestion',
            input: { questions: [{ question: 'Choose one', options: ['A', 'B'] }] },
          },
        ],
      },
    };

    const pending = parseClaudeTranscript(JSON.stringify(question));
    expect(pending[0]).toMatchObject({
      title: 'Tool · AskUserQuestion',
      toolCallId: 'question-1',
      toolStatus: 'running',
    });

    const resolved = parseClaudeTranscript(
      [
        question,
        {
          uuid: 'tool-result-1',
          timestamp: '2026-06-08T01:00:02.000Z',
          type: 'user',
          message: {
            role: 'user',
            content: [
              {
                type: 'tool_result',
                tool_use_id: 'question-1',
                content: 'A',
              },
            ],
          },
        },
      ]
        .map((row) => JSON.stringify(row))
        .join('\n')
    );
    expect(resolved.find((block) => block.toolCallId === 'question-1')).toMatchObject({
      toolStatus: 'completed',
    });
  });
});

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true }))
  );
});

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'yoda-claude-transcript-'));
  temporaryDirectories.push(directory);
  return directory;
}

async function createTranscriptFile(contents: string): Promise<string> {
  const filePath = join(await temporaryDirectory(), 'session.jsonl');
  await writeFile(filePath, contents);
  return filePath;
}

function row(value: Record<string, unknown>): string {
  return `${JSON.stringify(value)}\n`;
}

function userRow(uuid: string, content: unknown): string {
  return row({
    uuid,
    timestamp: '2026-08-15T01:00:00.000Z',
    type: 'user',
    message: { role: 'user', content },
  });
}

function assistantRow(uuid: string, content: unknown): string {
  return row({
    uuid,
    timestamp: '2026-08-15T01:00:01.000Z',
    type: 'assistant',
    message: { role: 'assistant', content },
  });
}

describe('ClaudeTranscriptReader', () => {
  it('parses only the rows appended since the previous read', async () => {
    const initialRaw = userRow('user-1', 'First prompt');
    const filePath = await createTranscriptFile(initialRaw);
    const reads: Array<{ position: number; length: number }> = [];
    const reader = new ClaudeTranscriptReader({
      onRead: (_path, position, length) => reads.push({ position, length }),
    });

    const initial = await reader.readFile(filePath);
    expect(initial?.map((block) => [block.id, block.content])).toEqual([
      ['user-1-user-0', 'First prompt'],
    ]);
    reads.length = 0;

    const appendedRaw = assistantRow('assistant-1', 'Answer');
    await appendFile(filePath, appendedRaw);
    const grown = await reader.readFile(filePath);

    expect(reads).toEqual([
      { position: Buffer.byteLength(initialRaw), length: Buffer.byteLength(appendedRaw) },
    ]);
    expect(grown?.map((block) => [block.id, block.content])).toEqual([
      ['user-1-user-0', 'First prompt'],
      ['assistant-1-assistant-1', 'Answer'],
    ]);
  });

  it('pairs an interactive tool call with a result that arrives in a later read', async () => {
    const filePath = await createTranscriptFile(
      assistantRow('assistant-question', [
        {
          type: 'tool_use',
          id: 'question-1',
          name: 'AskUserQuestion',
          input: { questions: [{ question: 'Choose one', options: ['A', 'B'] }] },
        },
      ])
    );
    const reader = new ClaudeTranscriptReader();

    const pending = await reader.readFile(filePath);
    expect(pending?.[0]).toMatchObject({ toolCallId: 'question-1', toolStatus: 'running' });

    await appendFile(
      filePath,
      userRow('tool-result-1', [{ type: 'tool_result', tool_use_id: 'question-1', content: 'A' }])
    );
    const resolved = await reader.readFile(filePath);

    expect(resolved?.find((block) => block.toolCallId === 'question-1')).toMatchObject({
      toolStatus: 'completed',
    });
  });

  it('rebuilds after truncation and after a same-length same-path replacement', async () => {
    const filePath = await createTranscriptFile(
      `${userRow('user-1', 'Old prompt')}${assistantRow('assistant-1', 'Old answer')}`
    );
    const reader = new ClaudeTranscriptReader();
    await reader.readFile(filePath);

    await writeFile(filePath, userRow('user-2', 'Fresh prompt'));
    expect((await reader.readFile(filePath))?.map((block) => block.content)).toEqual([
      'Fresh prompt',
    ]);

    // Byte-identical in length to the truncated file, so only the inode change
    // can force the rebuild. A provider that rewrites in place must not be
    // mistaken for a file that never moved.
    const replacementPath = join(filePath, '..', 'replacement.jsonl');
    const replacementRaw = userRow('user-3', 'Other prompt');
    await writeFile(replacementPath, replacementRaw);
    expect(Buffer.byteLength(replacementRaw)).toBe(
      Buffer.byteLength(userRow('user-2', 'Fresh prompt'))
    );
    await rename(replacementPath, filePath);

    expect((await reader.readFile(filePath))?.map((block) => block.content)).toEqual([
      'Other prompt',
    ]);
  });

  it('drops the oldest retained blocks past the content bound without reusing block ids', async () => {
    const filePath = await createTranscriptFile(userRow('user-1', 'a'.repeat(64)));
    const reader = new ClaudeTranscriptReader({ maxRetainedContentChars: 128 });
    await reader.readFile(filePath);

    await appendFile(filePath, userRow('user-2', 'b'.repeat(64)));
    await appendFile(filePath, userRow('user-3', 'c'.repeat(64)));
    const trimmed = await reader.readFile(filePath);

    expect(trimmed?.map((block) => [block.id, block.content[0]])).toEqual([
      ['user-2-user-1', 'b'],
      ['user-3-user-2', 'c'],
    ]);
  });

  it('returns null for a transcript that does not exist', async () => {
    const filePath = join(await temporaryDirectory(), 'missing.jsonl');

    await expect(new ClaudeTranscriptReader().readFile(filePath)).resolves.toBeNull();
  });
});
