import type { AgentSessionRuntimeStatus } from './events/agentEvents';
import type { RuntimeId } from './runtime-registry';

export type AppProcessResource = {
  pid: number;
  type: string;
  cpuPercent: number;
  memoryBytes: number;
};

export type AppRunningAgentSession = {
  projectId: string;
  taskId: string;
  conversationId: string;
  runtimeId: RuntimeId;
  title: string;
  taskTitle: string;
  status: AgentSessionRuntimeStatus;
  pid: number | null;
  cpuPercent: number;
  memoryBytes: number;
  outputBytesPerSecond: number;
  lastActivityAt: string | null;
  ringBufferBytes: number;
  ringBufferCapBytes: number;
  rendererConsumers: number;
  lifecycle: 'hot' | 'warm';
};

export type AppEventLoopMetrics = {
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  maxMs: number;
};

export type RendererPerformanceSample = {
  sampledAt: string;
  eventLoop: AppEventLoopMetrics;
  inputLatency: AppEventLoopMetrics;
  longTaskCount: number;
};

export type AgentAdmissionSnapshot = {
  mode: 'auto' | 'fixed' | 'unlimited';
  configuredLimit: number;
  effectiveLimit: number;
  memoryUsedPercent: number;
  queued: number;
  pausedReason: 'memory' | 'concurrency' | null;
};

export type AppResourceSnapshot = {
  sampledAt: string;
  cpuPercent: number;
  memoryBytes: number;
  activeAgentSessions: number;
  runningAgentSessions: AppRunningAgentSession[];
  processes: AppProcessResource[];
  mainEventLoop: AppEventLoopMetrics;
  rendererPerformance: RendererPerformanceSample | null;
  admission: AgentAdmissionSnapshot;
};

export type WorktreeStorageItem = {
  projectId: string;
  projectName: string;
  path: string;
  branch: string | null;
  sizeBytes: number;
  dirty: boolean;
  referencedByActiveTask: boolean;
  reclaimable: boolean;
};

export type WorktreeStorageSnapshot = {
  sampledAt: string;
  totalBytes: number;
  reclaimableBytes: number;
  worktreeCount: number;
  reclaimableCount: number;
  items: WorktreeStorageItem[];
};

export type WorktreeCleanupResult = {
  removedCount: number;
  reclaimedBytes: number;
  failedPaths: string[];
};
