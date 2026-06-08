import { defineEvent } from '@shared/ipc/events';

export type AgentEventType =
  | 'notification'
  | 'stop'
  | 'error'
  /** An interactive tool (AskUserQuestion / ExitPlanMode) is blocking on the user. */
  | 'awaiting-input'
  /** That interactive tool was answered — the agent resumes working. */
  | 'awaiting-input-resolved';

export type AgentSessionRuntimeStatus =
  | 'idle'
  | 'working'
  | 'awaiting-input'
  | 'error'
  | 'completed';

export function isAgentSessionRunningStatus(status: AgentSessionRuntimeStatus): boolean {
  return status === 'working' || status === 'awaiting-input';
}

export type NotificationType =
  | 'permission_prompt'
  | 'idle_prompt'
  | 'auth_success'
  | 'elicitation_dialog';

export const ATTENTION_NOTIFICATION_TYPES: ReadonlySet<NotificationType> = new Set([
  'permission_prompt',
  'idle_prompt',
  'elicitation_dialog',
]);

export function isAttentionNotification(nt: NotificationType | undefined): nt is NotificationType {
  return nt != null && ATTENTION_NOTIFICATION_TYPES.has(nt);
}

export interface AgentEvent {
  type: AgentEventType;
  source?: 'hook' | 'classifier';
  ptyId?: string;
  providerId?: string;
  projectId: string;
  taskId: string;
  conversationId: string;
  timestamp: number;
  payload: {
    notificationType?: NotificationType;
    title?: string;
    message?: string;
    lastAssistantMessage?: string;
  };
}

export interface AgentEventEnvelope {
  event: AgentEvent;
  appFocused: boolean;
}

export type SoundEvent = 'needs_attention' | 'task_complete';

export const agentEventChannel = defineEvent<AgentEventEnvelope>('agent:event');

export interface AgentSessionExited {
  /** PTY session ID (= conversationId for agent sessions). */
  projectId: string;
  sessionId: string;
  conversationId: string;
  taskId: string;
  exitCode: number | undefined;
}

/** Emitted when an agent PTY session exits. Topic = taskId. */
export const agentSessionExitedChannel = defineEvent<AgentSessionExited>('agent:session-exited');

export interface AgentSessionStatusChanged {
  projectId: string;
  taskId: string;
  conversationId: string;
  status: AgentSessionRuntimeStatus;
}

export const agentSessionStatusChangedChannel = defineEvent<AgentSessionStatusChanged>(
  'agent:session-status-changed'
);

/**
 * Emitted when a hook command runs while debug mode is enabled for a task.
 * Captured by Yoda's logging shim wrapped around each effective hook command.
 * Topic = taskId.
 */
export interface HookExecEvent {
  projectId: string;
  taskId: string;
  conversationId: string;
  providerId: string;
  /** Stable id of the hook (event:matcher:index) it corresponds to. */
  hookId: string;
  /** Hook event key, e.g. 'PreToolUse', 'Notification'. */
  hookEvent: string;
  command: string;
  exitCode: number | undefined;
  output?: string;
  timestamp: number;
}

export const hookExecChannel = defineEvent<HookExecEvent>('agent:hook-exec');
