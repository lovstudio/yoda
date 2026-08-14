import { defineEvent } from './ipc/events';

/** Correlates one renderer task-open interaction with main-process session startup work. */
export type SessionOpenPerformanceContext = {
  contextId: string;
  clickAtEpochMs: number;
};

export type SessionOpenPerformanceStage =
  | 'resume-received'
  | 'inflight-joined'
  | 'hydration-barrier'
  | 'operation-lock'
  | 'conversation-query'
  | 'task-resolve'
  | 'permission-reconcile'
  | 'surface-anchor'
  | 'session-classified'
  | 'external-writer-probe'
  | 'provider-start'
  | 'provider-preflight'
  | 'tmux-marker-probe'
  | 'provider-spawn'
  | 'pty-registered'
  | 'pty-first-output'
  | 'tmux-reattach-confirm'
  | 'provider-committed'
  | 'resume-resolved';

export type SessionOpenPerformanceEvent = {
  context_id: string;
  operation_id: string;
  projectId: string;
  taskId: string;
  conversationId: string;
  sessionId: string;
  stage: SessionOpenPerformanceStage;
  elapsedMs: number;
  sinceClickMs: number;
  [detail: string]: boolean | number | string | null | undefined;
};

export const sessionOpenPerformanceChannel = defineEvent<SessionOpenPerformanceEvent>(
  'session-open:performance'
);
