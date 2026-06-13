import type { DeepLinkTarget } from '@shared/deep-links';
import type { DependencyStatusUpdatedEvent } from '@shared/dependencies';
import { defineEvent } from '@shared/ipc/events';
import type { RuntimeId } from '@shared/runtime-registry';
import type { TaskWindowTarget } from '@shared/task-window';

// App editing actions (renderer → main, no payload)
export const appUndoChannel = defineEvent<void>('app:undo');
export const appRedoChannel = defineEvent<void>('app:redo');
export const appPasteChannel = defineEvent<void>('app:paste');

// Menu events (main → renderer, no payload)
export const menuOpenSettingsChannel = defineEvent<void>('menu:open-settings');
export const menuCheckForUpdatesChannel = defineEvent<void>('menu:check-for-updates');
export const menuUndoChannel = defineEvent<void>('menu:undo');
export const menuRedoChannel = defineEvent<void>('menu:redo');
export const menuCloseTabChannel = defineEvent<void>('menu:close-tab');
export const menuToggleLeftSidebarChannel = defineEvent<void>('menu:toggle-left-sidebar');

export const gitStatusChangedChannel = defineEvent<{
  taskPath: string;
  error?: string;
}>('git:status-changed');

export const notificationFocusTaskChannel = defineEvent<{
  projectId: string;
  taskId: string;
  conversationId?: string;
}>('notification:focus-task');

export const deepLinkOpenChannel = defineEvent<DeepLinkTarget>('deep-link:open');

export type TaskWindowReturnPayload = {
  sourceWindowId: number;
  target: TaskWindowTarget;
};

export const taskWindowReturnedToTabChannel = defineEvent<TaskWindowReturnPayload>(
  'task-window:returned-to-tab'
);

/**
 * Main → main-window renderer: a detached task window is being dragged over (or
 * away from) the task tab strip drop zone, so the strip should toggle its
 * "drop to dock" highlight.
 */
export const taskWindowDockHoverChannel = defineEvent<{ hovering: boolean }>(
  'task-window:dock-hover'
);

/**
 * Main → main-window renderer: a detached task window was released over the tab
 * strip drop zone. The main window re-opens the tab locally, then acks via
 * `notifyTaskWindowReturned` so the detached window closes itself.
 */
export const taskWindowDockRequestChannel = defineEvent<TaskWindowReturnPayload>(
  'task-window:dock-request'
);

/**
 * Main → a specific pre-warmed task window: assign the task target it should
 * display. The window boots its React shell empty and parks until this arrives,
 * which makes tearing out a tab feel instant (no cold renderer boot).
 */
export const taskWindowAssignTargetChannel = defineEvent<TaskWindowTarget>(
  'task-window:assign-target'
);

export const ptyStartedChannel = defineEvent<{
  id: string;
}>('pty:started');

export type PlanEvent = {
  type: 'write_blocked' | 'remove_blocked';
  root: string;
  relPath: string;
  code?: string;
  message?: string;
};

export const planEventChannel = defineEvent<PlanEvent>('plan:event');

export const ptyDataChannel = defineEvent<string>('pty:data');

export const ptyExitChannel = defineEvent<{
  exitCode: number;
  signal?: number;
}>('pty:exit');

/** Emitted by main process when a PTY is definitively killed (e.g. on deleteTask/deleteConversation). */
export const ptyKilledChannel = defineEvent<{ id: string }>('pty:killed');

/** Emitted by main process when a lifecycle/dev-server shell session is created.
 *  These sessions are standalone PTYs — they are NOT backed by a DB conversation record.
 *  The renderer uses sessionId (not conversationId) to connect to the PTY terminal.
 */
export const shellSessionStartedChannel = defineEvent<{
  taskId: string;
  /** Opaque UUID identifying this PTY session — not a DB conversationId. */
  sessionId: string;
  ptyId: string;
  title: string;
}>('shell:session-started');

/** Emitted whenever an AI invocation log row is inserted or updated. */
export const aiLogUpdatedChannel = defineEvent<{ id: string }>('ai-log:updated');

/** Emitted after each dependency probe completes (path resolution or version check). */
export const dependencyStatusUpdatedChannel = defineEvent<DependencyStatusUpdatedEvent>(
  'dependency:status-updated'
);

export const tmuxUnavailableChannel = defineEvent<{
  source: string;
  sessionId: string;
  requested: boolean;
  auto: boolean;
  connectionId?: string;
}>('tmux:unavailable');

export type QuitAgentSessionInfo = {
  sessionId: string;
  conversationId: string;
  projectId: string;
  taskId: string;
  taskTitle?: string;
  runtimeId: RuntimeId;
  title: string;
  detachable: boolean;
};

export type QuitAgentSessionsRequest = {
  requestId: string;
  running: number;
  keepable: number;
  nonKeepableSessions: QuitAgentSessionInfo[];
};

export type QuitAgentSessionsResponse =
  | { requestId: string; action: 'cancel' }
  | { requestId: string; action: 'quit'; mode: 'detach' | 'terminate' };

export const quitAgentSessionsRequestedChannel = defineEvent<QuitAgentSessionsRequest>(
  'app:quit-agent-sessions-requested'
);

export const quitAgentSessionsRespondedChannel = defineEvent<QuitAgentSessionsResponse>(
  'app:quit-agent-sessions-responded'
);
