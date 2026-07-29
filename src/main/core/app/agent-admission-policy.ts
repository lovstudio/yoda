import {
  isAgentSessionRunningStatus,
  type AgentSessionRuntimeStatus,
} from '@shared/events/agentEvents';

const AUTO_AGENT_MEMORY_BYTES = 1536 * 1024 * 1024;
const AUTO_MEMORY_RESERVE_MIN_BYTES = 4 * 1024 * 1024 * 1024;
const AUTO_LIMIT_MAX = 8;

export function countActiveAgentAdmissions(
  entries: ReadonlyArray<{ status: AgentSessionRuntimeStatus }>,
  reservationCount: number
): number {
  return (
    entries.filter(({ status }) => isAgentSessionRunningStatus(status)).length + reservationCount
  );
}

export function calculateAutomaticAgentLimit(
  totalMemoryBytes: number,
  logicalCpuCount: number
): number {
  const memoryReserve = Math.max(AUTO_MEMORY_RESERVE_MIN_BYTES, totalMemoryBytes * 0.25);
  const memoryLimit = Math.max(
    1,
    Math.floor(Math.max(0, totalMemoryBytes - memoryReserve) / AUTO_AGENT_MEMORY_BYTES)
  );
  const cpuLimit = Math.max(1, Math.floor(logicalCpuCount * 0.5));
  return Math.min(AUTO_LIMIT_MAX, memoryLimit, cpuLimit);
}
