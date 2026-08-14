import { describe, expect, it } from 'vitest';
import {
  parseClaudeBackgroundJobs,
  retireBackgroundJobsFromEarlierRuns,
} from './claude-background-jobs';

/**
 * Row shapes here are transcribed from real Claude Code transcripts
 * (CC 2.1.169–2.1.232), including the three unrelated row shapes a completion
 * notification can arrive in.
 */

function jsonl(rows: Array<Record<string, unknown>>): string {
  return rows.map((r) => JSON.stringify(r)).join('\n');
}

const T0 = '2026-08-14T17:31:32.737Z';
const T1 = '2026-08-14T17:31:52.858Z';

function bashCall(id: string, command: string, description: string) {
  return {
    type: 'assistant',
    timestamp: T0,
    message: {
      role: 'assistant',
      content: [
        {
          type: 'tool_use',
          id,
          name: 'Bash',
          input: { command, description, run_in_background: true },
        },
      ],
    },
  };
}

function bashResult(id: string, taskId: string) {
  return {
    type: 'user',
    timestamp: T0,
    message: {
      role: 'user',
      content: [
        {
          tool_use_id: id,
          type: 'tool_result',
          content: `Command running in background with ID: ${taskId}. Output is being written to: /private/tmp/claude-501/-proj/sess/tasks/${taskId}.output. You will be notified when it completes.`,
          is_error: false,
        },
      ],
    },
    toolUseResult: {
      stdout: '',
      stderr: '',
      interrupted: false,
      isImage: false,
      noOutputExpected: false,
      backgroundTaskId: taskId,
    },
  };
}

function notificationBody(taskId: string, status: string): string {
  return [
    '<task-notification>',
    `<task-id>${taskId}</task-id>`,
    '<tool-use-id>toolu_01Vgyr</tool-use-id>',
    `<output-file>/private/tmp/claude-501/-proj/sess/tasks/${taskId}.output</output-file>`,
    `<status>${status}</status>`,
    `<summary>Background command "启动 2-pass 压制" completed (exit code 0)</summary>`,
    '</task-notification>',
  ].join('\n');
}

describe('parseClaudeBackgroundJobs', () => {
  it('reports a launched background shell as running, with its command and output path', () => {
    const jobs = parseClaudeBackgroundJobs(
      jsonl([
        bashCall('toolu_1', 'nohup bash render.sh &', '启动压制'),
        bashResult('toolu_1', 'b5jtgzpuh'),
      ])
    );
    expect(jobs).toEqual([
      {
        taskId: 'b5jtgzpuh',
        kind: 'bash',
        status: 'running',
        command: 'nohup bash render.sh &',
        description: '启动压制',
        outputPath: '/private/tmp/claude-501/-proj/sess/tasks/b5jtgzpuh.output',
        startedAt: Date.parse(T0),
      },
    ]);
  });

  it('closes the job when the notification arrives as a queue-operation row', () => {
    const jobs = parseClaudeBackgroundJobs(
      jsonl([
        bashCall('toolu_1', 'sleep 60', 'wait'),
        bashResult('toolu_1', 'b5jtgzpuh'),
        {
          type: 'queue-operation',
          operation: 'enqueue',
          timestamp: T1,
          content: notificationBody('b5jtgzpuh', 'completed'),
        },
      ])
    );
    expect(jobs[0]?.status).toBe('completed');
    expect(jobs[0]?.endedAt).toBe(Date.parse(T1));
    expect(jobs[0]?.summary).toContain('2-pass');
  });

  it('closes the job when the notification arrives as a queued_command attachment', () => {
    const jobs = parseClaudeBackgroundJobs(
      jsonl([
        bashCall('toolu_1', 'sleep 60', 'wait'),
        bashResult('toolu_1', 'b5jtgzpuh'),
        {
          type: 'attachment',
          timestamp: T1,
          attachment: {
            type: 'queued_command',
            commandMode: 'task-notification',
            prompt: notificationBody('b5jtgzpuh', 'completed'),
          },
        },
      ])
    );
    expect(jobs[0]?.status).toBe('completed');
  });

  it('closes the job when the notification wakes the session as a system-origin user row', () => {
    const jobs = parseClaudeBackgroundJobs(
      jsonl([
        bashCall('toolu_1', 'sleep 60', 'wait'),
        bashResult('toolu_1', 'b5jtgzpuh'),
        {
          type: 'user',
          timestamp: T1,
          promptSource: 'system',
          origin: { kind: 'task-notification' },
          message: { role: 'user', content: notificationBody('b5jtgzpuh', 'completed') },
        },
      ])
    );
    expect(jobs[0]?.status).toBe('completed');
  });

  it('stays closed when the same notification repeats across row shapes', () => {
    const body = notificationBody('b5jtgzpuh', 'completed');
    const jobs = parseClaudeBackgroundJobs(
      jsonl([
        bashCall('toolu_1', 'sleep 60', 'wait'),
        bashResult('toolu_1', 'b5jtgzpuh'),
        { type: 'queue-operation', operation: 'enqueue', timestamp: T1, content: body },
        {
          type: 'attachment',
          timestamp: T1,
          attachment: { type: 'queued_command', commandMode: 'task-notification', prompt: body },
        },
      ])
    );
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.status).toBe('completed');
  });

  it('maps killed and stopped to a deliberate stop rather than a failure', () => {
    for (const status of ['killed', 'stopped']) {
      const jobs = parseClaudeBackgroundJobs(
        jsonl([
          bashCall('toolu_1', 'sleep 60', 'wait'),
          bashResult('toolu_1', 'b1'),
          { type: 'queue-operation', timestamp: T1, content: notificationBody('b1', status) },
        ])
      );
      expect(jobs[0]?.status).toBe('stopped');
    }
    const failed = parseClaudeBackgroundJobs(
      jsonl([
        bashCall('toolu_1', 'sleep 60', 'wait'),
        bashResult('toolu_1', 'b1'),
        { type: 'queue-operation', timestamp: T1, content: notificationBody('b1', 'failed') },
      ])
    );
    expect(failed[0]?.status).toBe('failed');
  });

  it('does NOT close a job because the conversation merely mentions the tag', () => {
    // An agent discussing <task-notification> in its own message, or writing it
    // into a file, must not be mistaken for a real notification.
    const body = notificationBody('b5jtgzpuh', 'completed');
    const jobs = parseClaudeBackgroundJobs(
      jsonl([
        bashCall('toolu_1', 'sleep 60', 'wait'),
        bashResult('toolu_1', 'b5jtgzpuh'),
        {
          type: 'assistant',
          timestamp: T1,
          message: { role: 'assistant', content: [{ type: 'text', text: `parsing ${body}` }] },
        },
        {
          type: 'user',
          timestamp: T1,
          message: { role: 'user', content: [{ type: 'text', text: `explain ${body}` }] },
        },
      ])
    );
    expect(jobs[0]?.status).toBe('running');
  });

  it('tracks a Monitor watch, keyed on its launching call', () => {
    const jobs = parseClaudeBackgroundJobs(
      jsonl([
        {
          type: 'assistant',
          timestamp: T0,
          message: {
            role: 'assistant',
            content: [
              {
                type: 'tool_use',
                id: 'toolu_m',
                name: 'Monitor',
                input: { command: 'tail -f build.log', description: '压制进度', persistent: true },
              },
            ],
          },
        },
        {
          type: 'user',
          timestamp: T0,
          message: {
            role: 'user',
            content: [
              {
                tool_use_id: 'toolu_m',
                type: 'tool_result',
                content: 'Monitor started (task bqh3xsxcg, persistent — runs until TaskStop).',
              },
            ],
          },
          toolUseResult: { taskId: 'bqh3xsxcg', timeoutMs: 0, persistent: true },
        },
      ])
    );
    expect(jobs).toEqual([
      {
        taskId: 'bqh3xsxcg',
        kind: 'monitor',
        status: 'running',
        command: 'tail -f build.log',
        description: '压制进度',
        outputPath: undefined,
        startedAt: Date.parse(T0),
      },
    ]);
  });

  it('tracks an async sub-agent from its own result fields', () => {
    const jobs = parseClaudeBackgroundJobs(
      jsonl([
        {
          type: 'assistant',
          timestamp: T0,
          message: {
            role: 'assistant',
            content: [
              {
                type: 'tool_use',
                id: 'toolu_a',
                name: 'Agent',
                input: { prompt: 'explore', description: 'Map surfaces' },
              },
            ],
          },
        },
        {
          type: 'user',
          timestamp: T0,
          message: {
            role: 'user',
            content: [
              {
                tool_use_id: 'toolu_a',
                type: 'tool_result',
                content: [{ type: 'text', text: 'Async agent launched' }],
              },
            ],
          },
          toolUseResult: {
            isAsync: true,
            status: 'async_launched',
            agentId: 'ab7a37ab477c82193',
            description: 'Map surfaces',
            outputFile: '/private/tmp/claude-501/-proj/sess/tasks/ab7a37ab477c82193.output',
          },
        },
      ])
    );
    expect(jobs).toEqual([
      {
        taskId: 'ab7a37ab477c82193',
        kind: 'agent',
        status: 'running',
        description: 'Map surfaces',
        outputPath: '/private/tmp/claude-501/-proj/sess/tasks/ab7a37ab477c82193.output',
        startedAt: Date.parse(T0),
      },
    ]);
  });

  it('ignores an ordinary foreground Bash result', () => {
    const jobs = parseClaudeBackgroundJobs(
      jsonl([
        bashCall('toolu_1', 'ls', 'list'),
        {
          type: 'user',
          timestamp: T0,
          message: {
            role: 'user',
            content: [{ tool_use_id: 'toolu_1', type: 'tool_result', content: 'a\nb' }],
          },
          toolUseResult: { stdout: 'a\nb', stderr: '', interrupted: false, isImage: false },
        },
      ])
    );
    expect(jobs).toEqual([]);
  });

  it("ignores a sub-agent's own inlined tool calls", () => {
    const rows = [bashCall('toolu_1', 'sleep 60', 'wait'), bashResult('toolu_1', 'b5jtgzpuh')].map(
      (row) => ({ ...row, isSidechain: true })
    );
    expect(parseClaudeBackgroundJobs(jsonl(rows))).toEqual([]);
  });

  it('ignores a notification for a job whose launch row is not in this file', () => {
    const jobs = parseClaudeBackgroundJobs(
      jsonl([
        { type: 'queue-operation', timestamp: T1, content: notificationBody('bgone', 'completed') },
      ])
    );
    expect(jobs).toEqual([]);
  });

  it('tolerates malformed lines', () => {
    const raw = [
      'not json',
      '[]',
      JSON.stringify(bashCall('toolu_1', 'sleep 60', 'wait')),
      '',
      JSON.stringify(bashResult('toolu_1', 'b5jtgzpuh')),
    ].join('\n');
    expect(parseClaudeBackgroundJobs(raw).map((j) => j.taskId)).toEqual(['b5jtgzpuh']);
  });
});

describe('retireBackgroundJobsFromEarlierRuns', () => {
  const running = {
    taskId: 'b1',
    kind: 'bash' as const,
    status: 'running' as const,
    startedAt: 1_000,
  };

  it('stops a job that a previous CLI process launched', () => {
    expect(retireBackgroundJobsFromEarlierRuns([running], 2_000)[0]?.status).toBe('stopped');
  });

  it('keeps a job launched by the current session', () => {
    expect(retireBackgroundJobsFromEarlierRuns([running], 500)[0]?.status).toBe('running');
  });

  it('leaves already-terminal jobs alone', () => {
    const done = { ...running, status: 'completed' as const };
    expect(retireBackgroundJobsFromEarlierRuns([done], 2_000)[0]?.status).toBe('completed');
  });

  it('passes everything through when the session start time is unknown', () => {
    expect(retireBackgroundJobsFromEarlierRuns([running], 0)[0]?.status).toBe('running');
  });
});
