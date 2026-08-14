import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  sessionOpenPerformanceChannel,
  type SessionOpenPerformanceEvent,
} from '@shared/session-open-performance';
import { wireSessionOpenPerformanceBridge } from './session-open-performance-bridge';

const mocks = vi.hoisted(() => ({
  off: vi.fn(),
  on: vi.fn(),
}));

vi.mock('@renderer/lib/ipc', () => ({
  events: { on: mocks.on },
}));

describe('wireSessionOpenPerformanceBridge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.on.mockReturnValue(mocks.off);
  });

  it('prints correlated main stages and returns the event unsubscribe', () => {
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const off = wireSessionOpenPerformanceBridge();
      expect(mocks.on).toHaveBeenCalledWith(sessionOpenPerformanceChannel, expect.any(Function));

      const listener = mocks.on.mock.calls[0]?.[1] as
        | ((entry: SessionOpenPerformanceEvent) => void)
        | undefined;
      const entry: SessionOpenPerformanceEvent = {
        context_id: 'task-open-1',
        operation_id: 'session-open-1',
        projectId: 'project-1',
        taskId: 'task-1',
        conversationId: 'conversation-1',
        sessionId: 'project-1:task-1:conversation-1',
        stage: 'pty-first-output',
        elapsedMs: 712.4,
        sinceClickMs: 804.2,
        byteLength: 42,
      };
      listener?.(entry);

      expect(consoleLog).toHaveBeenCalledWith('[DEBUG][task-open-main] pty-first-output:', entry);
      expect(off).toBe(mocks.off);
    } finally {
      consoleLog.mockRestore();
    }
  });
});
