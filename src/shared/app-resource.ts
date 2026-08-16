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

export type AppResourceSnapshotOptions = {
  /** Keep external agent process trees fresh while their detail panel is visible. */
  freshAgentProcesses?: boolean;
};

/** Immutable machine limits used to size adaptive caches. */
export type MachineCapacity = {
  totalMemoryBytes: number;
  cpuCount: number;
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

export type UnregisteredWorktreeStorageItem = {
  projectId: string;
  projectName: string;
  path: string;
  sizeBytes: number | null;
  modifiedAt: string | null;
  inspectedAt: string | null;
  inspectionPending: boolean;
  inspectionFailed: boolean;
};

export type WorktreeStorageSnapshot = {
  sampledAt: string;
  totalBytes: number;
  reclaimableBytes: number;
  worktreeCount: number;
  registeredActiveCount: number;
  registeredDirtyCount: number;
  reclaimableCount: number;
  pendingInspectionCount: number;
  unregisteredUnknownCount: number;
  unregisteredUnknownBytes: number;
  unregisteredUnknownInspectionPendingCount: number;
  unregisteredUnknownInventoryPendingProjectCount: number;
  unregisteredUnknownScanInProgress: boolean;
  oldestUnregisteredUnknownAt: string | null;
  items: WorktreeStorageItem[];
  unregisteredUnknownItems: UnregisteredWorktreeStorageItem[];
};

export type WorktreeStorageSnapshotOptions = {
  forceRefresh?: boolean;
};

export type WorktreeCleanupResult = {
  removedCount: number;
  reclaimedBytes: number;
  failedPaths: string[];
};

export type TmuxSessionOwnerKind =
  | 'conversation'
  | 'task-terminal'
  | 'workspace-terminal'
  | 'unknown';

export type TmuxReclamationBlocker =
  | 'active-owner'
  | 'attached-client'
  | 'live-pty'
  | 'renderer-consumer'
  | 'grace-period'
  | 'unknown-activity';

export type TmuxReclamationItem = {
  sessionId: string;
  sessionName: string;
  cwd: string;
  ownerKind: TmuxSessionOwnerKind;
  ownerId: string | null;
  ownerState: 'active' | 'archived' | 'missing';
  attachedClients: number;
  rendererConsumers: number;
  lastActivityAt: string | null;
  reclaimable: boolean;
  blockers: TmuxReclamationBlocker[];
};

export type TmuxReclamationSnapshot = {
  sampledAt: string;
  gracePeriodMs: number;
  sessionCount: number;
  activeOwnedCount: number;
  archivedOwnedCount: number;
  missingOwnerCount: number;
  reclaimableCount: number;
  items: TmuxReclamationItem[];
};

export type TmuxCleanupResult = {
  terminatedCount: number;
  alreadyStoppedCount: number;
  skippedCount: number;
  failedSessionIds: string[];
};
