import { describe, expect, it } from 'vitest';
import { rankWorkspaceAgentSessions } from './workspace-agent-sessions';

function session(
  conversationId: string,
  status: 'idle' | 'working' | 'awaiting-input',
  memoryBytes = 0
) {
  return {
    conversationId,
    status,
    memoryBytes,
    cpuPercent: 0,
    lastActivityAt: null,
  };
}

describe('rankWorkspaceAgentSessions', () => {
  it('prioritizes attention, active work, and then resource-heavy idle sessions', () => {
    expect(
      rankWorkspaceAgentSessions([
        session('idle-light', 'idle', 100),
        session('working', 'working', 10),
        session('idle-heavy', 'idle', 500),
        session('attention', 'awaiting-input', 1),
      ]).map((item) => item.conversationId)
    ).toEqual(['attention', 'working', 'idle-heavy', 'idle-light']);
  });
});
