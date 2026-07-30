import type { AgentSessionRuntimeStatus } from './events/agentEvents';
import type { RuntimeId } from './runtime-registry';

export type AppProcessResource = {
  pid: number;
  type: string;
  cpuPercent: number;
  memoryBytes: number;
};

export type AppAgentSessionResource = {
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
  tmuxBacked: boolean;
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

export type AppResourceSnapshot = {
  sampledAt: string;
  cpuPercent: number;
  memoryBytes: number;
  agentSessions: AppAgentSessionResource[];
  processes: AppProcessResource[];
  mainEventLoop: AppEventLoopMetrics;
  rendererPerformance: RendererPerformanceSample | null;
};

export type WorktreeStorageItem = {
  projectId: string;
  projectName: string;
  path: string;
  branch: string | null;
  activeTaskId: string | null;
  activeTaskName: string | null;
  sizeBytes: number;
  dirty: boolean;
  inspectedAt: string | null;
  inspectionPending: boolean;
  referencedByActiveTask: boolean;
  reclaimable: boolean;
};

export type WorktreeStorageSnapshot = {
  sampledAt: string;
  totalBytes: number;
  reclaimableBytes: number;
  worktreeCount: number;
  reclaimableCount: number;
  pendingInspectionCount: number;
  items: WorktreeStorageItem[];
};

export type WorktreeStorageSnapshotOptions = {
  forceRefresh?: boolean;
};

export type WorktreeCleanupResult = {
  removedCount: number;
  reclaimedBytes: number;
  failedPaths: string[];
};
