import { defineEvent } from './ipc/events';
import type { RuntimeId } from './runtime-registry';

export const DEFAULT_ISSUE_WORKER_CONCURRENCY = 2;
export const DEFAULT_ISSUE_WORKER_POLL_INTERVAL_SECONDS = 60;
export const MIN_ISSUE_WORKER_POLL_INTERVAL_SECONDS = 15;
export const MAX_ISSUE_WORKER_POLL_INTERVAL_SECONDS = 3_600;
export const MAX_ISSUE_WORKER_CONCURRENCY = 8;

export type IssueWorkerProjectConfig = {
  enabled: boolean;
  runtime: RuntimeId;
  concurrency: number;
  pollIntervalSeconds: number;
  /** Tasks created by the worker and still awaiting an Agent terminal event. */
  managedTaskIds: string[];
};

export type IssueWorkerSettings = {
  projects: Record<string, IssueWorkerProjectConfig>;
};

export type IssueWorkerState = 'disabled' | 'idle' | 'syncing' | 'at-capacity' | 'error';

export type IssueWorkerStatus = {
  projectId: string;
  state: IssueWorkerState;
  config: IssueWorkerProjectConfig | null;
  activeCount: number;
  queuedCount: number;
  lastSyncAt: string | null;
  nextSyncAt: string | null;
  lastError: string | null;
};

export type IssueWorkerConfigPatch = Partial<
  Pick<IssueWorkerProjectConfig, 'enabled' | 'runtime' | 'concurrency' | 'pollIntervalSeconds'>
>;

export const issueWorkerUpdatedChannel = defineEvent<IssueWorkerStatus>('issues:worker-updated');
