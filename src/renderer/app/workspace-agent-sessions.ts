import type { AgentSessionRuntimeStatus } from '@shared/events/agentEvents';

export type RankableWorkspaceAgentSession = {
  conversationId: string;
  status: AgentSessionRuntimeStatus;
  cpuPercent: number;
  memoryBytes: number;
  lastActivityAt: string | null;
};

const STATUS_PRIORITY: Record<AgentSessionRuntimeStatus, number> = {
  'awaiting-input': 0,
  working: 1,
  idle: 2,
  error: 3,
  completed: 4,
};

/**
 * Put sessions that need the user first, then live work, then resource-heavy
 * idle sessions. The stable id fallback keeps the list from jumping when
 * resource samples tie.
 */
export function rankWorkspaceAgentSessions<T extends RankableWorkspaceAgentSession>(
  sessions: readonly T[]
): T[] {
  return [...sessions].sort((left, right) => {
    const statusDifference = STATUS_PRIORITY[left.status] - STATUS_PRIORITY[right.status];
    if (statusDifference !== 0) return statusDifference;
    const memoryDifference = right.memoryBytes - left.memoryBytes;
    if (memoryDifference !== 0) return memoryDifference;
    const cpuDifference = right.cpuPercent - left.cpuPercent;
    if (cpuDifference !== 0) return cpuDifference;
    const activityDifference =
      Date.parse(right.lastActivityAt ?? '') - Date.parse(left.lastActivityAt ?? '');
    if (Number.isFinite(activityDifference) && activityDifference !== 0) {
      return activityDifference;
    }
    return left.conversationId.localeCompare(right.conversationId);
  });
}
