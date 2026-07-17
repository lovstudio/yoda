export type AppProcessResource = {
  pid: number;
  type: string;
  cpuPercent: number;
  memoryBytes: number;
};

export type AppResourceSnapshot = {
  sampledAt: string;
  cpuPercent: number;
  memoryBytes: number;
  activeAgentSessions: number;
  processes: AppProcessResource[];
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
