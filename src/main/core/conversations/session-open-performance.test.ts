import { describe, expect, it, vi } from 'vitest';
import { createSessionOpenPerformanceTrace } from './session-open-performance';

vi.mock('@main/lib/logger', () => ({ log: { info: vi.fn() } }));
vi.mock('@main/lib/events', () => ({ events: { emit: vi.fn() } }));

describe('SessionOpenPerformanceTrace', () => {
  it('records correlated elapsed, span, and click-relative timings', async () => {
    let monotonic = 10;
    let epoch = 1_100;
    const write = vi.fn();
    const trace = createSessionOpenPerformanceTrace(
      { contextId: 'task-open-1', clickAtEpochMs: 1_000 },
      {
        projectId: 'project-1',
        taskId: 'task-1',
        conversationId: 'conversation-1',
        sessionId: 'project-1:task-1:conversation-1',
      },
      {
        monotonicNow: () => monotonic,
        epochNow: () => epoch,
        operationId: () => 'session-open-1',
        write,
      }
    );

    monotonic = 12.25;
    epoch = 1_104;
    const operation = trace?.measure('conversation-query', async () => {
      monotonic = 17.5;
      epoch = 1_111;
      return ['row'];
    });
    await expect(operation).resolves.toEqual(['row']);

    expect(write).toHaveBeenCalledWith(
      '[session-open-main]',
      expect.objectContaining({
        context_id: 'task-open-1',
        operation_id: 'session-open-1',
        projectId: 'project-1',
        taskId: 'task-1',
        conversationId: 'conversation-1',
        sessionId: 'project-1:task-1:conversation-1',
        stage: 'conversation-query',
        durationMs: 5.3,
        elapsedMs: 7.5,
        sinceClickMs: 111,
        success: true,
      })
    );
  });

  it('records only the error kind and suppresses repeated one-shot stages', async () => {
    const write = vi.fn();
    const trace = createSessionOpenPerformanceTrace(
      { contextId: 'task-open-1', clickAtEpochMs: 1_000 },
      {
        projectId: 'project-1',
        taskId: 'task-1',
        conversationId: 'conversation-1',
        sessionId: 'project-1:task-1:conversation-1',
      },
      {
        monotonicNow: () => 10,
        epochNow: () => 1_010,
        operationId: () => 'session-open-1',
        write,
      }
    );

    await expect(
      trace?.measure('external-writer-probe', async () => {
        throw new TypeError('/private/path must not be logged');
      })
    ).rejects.toThrow('must not be logged');
    trace?.markOnce('pty-first-output', { byteLength: 4 });
    trace?.markOnce('pty-first-output', { byteLength: 8 });

    expect(write).toHaveBeenCalledTimes(2);
    expect(write.mock.calls[0]?.[1]).toMatchObject({
      stage: 'external-writer-probe',
      success: false,
      errorKind: 'TypeError',
    });
    expect(JSON.stringify(write.mock.calls)).not.toContain('/private/path');
    expect(write.mock.calls[1]?.[1]).toMatchObject({
      stage: 'pty-first-output',
      byteLength: 4,
    });
  });

  it('does not allocate a trace without renderer correlation context', () => {
    expect(
      createSessionOpenPerformanceTrace(undefined, {
        projectId: 'project-1',
        taskId: 'task-1',
        conversationId: 'conversation-1',
        sessionId: 'project-1:task-1:conversation-1',
      })
    ).toBeUndefined();
  });
});
