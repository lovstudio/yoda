import { PRODUCT_NAME } from '@shared/app-identity';
import { isAgentSessionRunningStatus } from '@shared/events/agentEvents';
import { getRuntime } from '@shared/runtime-registry';
import type { ActiveConversationSession } from '@main/core/conversations/types';
import type { ActiveAgentSessionSummary } from '@main/core/tasks/task-manager';
import type {
  ActiveWorkspaceTerminalSession,
  ActiveWorkspaceTerminalSessionSummary,
} from '@main/core/terminals/workspace-terminal-service';
import type { TeardownMode } from '@main/core/workspaces/workspace-registry';

export type QuitAgentSessionsDecision =
  | { action: 'quit'; mode: TeardownMode }
  | { action: 'cancel' };

type QuitDialogOptions = {
  type: 'question';
  buttons: string[];
  defaultId: number;
  cancelId: number;
  title: string;
  message: string;
  detail: string;
  noLink: boolean;
};

type ShowQuitDialog = (options: QuitDialogOptions) => number;

type QuitSessionInfo =
  | ActiveAgentSessionSummary['nonKeepableSessions'][number]
  | ActiveWorkspaceTerminalSession;

export type ActiveQuitSessionSummary = {
  running: number;
  keepable: number;
  agentSessions: number;
  terminalSessions: number;
  nonKeepableSessions: QuitSessionInfo[];
};

type RestartAgentSession = ActiveConversationSession & {
  status: Parameters<typeof isAgentSessionRunningStatus>[0];
};

/**
 * Quit keeps its existing running-only contract. Restart must also protect
 * idle/completed tmux sessions: terminating them would destroy work that can
 * otherwise survive the application relaunch, regardless of whether Yoda's
 * transport is currently attached.
 */
export function resolveAgentSessionSummaryForShutdown(
  restartRequested: boolean,
  runningSummary: ActiveAgentSessionSummary,
  agentSessions: readonly RestartAgentSession[]
): ActiveAgentSessionSummary {
  if (!restartRequested) return runningSummary;

  const protectedSessions = agentSessions.filter(
    (session) => session.detachable || isAgentSessionRunningStatus(session.status)
  );
  return {
    running: protectedSessions.length,
    keepable: protectedSessions.filter((session) => session.detachable).length,
    nonKeepableSessions: protectedSessions.filter((session) => !session.detachable),
  };
}

function pluralize(count: number, singular: string, plural: string): string {
  return count === 1 ? singular : plural;
}

function messageFor(summary: ActiveQuitSessionSummary): string {
  if (summary.agentSessions > 0 && summary.terminalSessions > 0) {
    return `${summary.agentSessions} ${pluralize(summary.agentSessions, 'agent session', 'agent sessions')} and ${summary.terminalSessions} ${pluralize(summary.terminalSessions, 'terminal session', 'terminal sessions')} are still running.`;
  }
  if (summary.terminalSessions > 0) {
    return summary.terminalSessions === 1
      ? 'A terminal session is still running.'
      : `${summary.terminalSessions} terminal sessions are still running.`;
  }
  return summary.agentSessions === 1
    ? 'An agent session is still running.'
    : `${summary.agentSessions} agent sessions are still running.`;
}

type SessionDetail = ActiveQuitSessionSummary['nonKeepableSessions'][number];

const MAX_VISIBLE_SESSION_DETAILS = 8;
const MAX_SESSION_LABEL_LENGTH = 96;

function truncateLabel(value: string): string {
  if (value.length <= MAX_SESSION_LABEL_LENGTH) return value;
  return `${value.slice(0, MAX_SESSION_LABEL_LENGTH - 3)}...`;
}

function sessionLabel(session: SessionDetail): string {
  if ('terminalId' in session) {
    return truncateLabel(`${session.name.trim() || session.terminalId} (Terminal)`);
  }
  const taskTitle = session.taskTitle?.trim() || session.taskId;
  const title = session.title.trim() || session.conversationId;
  const runtimeName = getRuntime(session.runtimeId)?.name ?? session.runtimeId;
  return truncateLabel(`${taskTitle} - ${title} (${runtimeName})`);
}

function formatSessionList(sessions: SessionDetail[]): string {
  if (sessions.length === 0) return '';

  const visible = sessions.slice(0, MAX_VISIBLE_SESSION_DETAILS).map((session) => {
    return `- ${sessionLabel(session)}`;
  });
  const hiddenCount = sessions.length - visible.length;
  if (hiddenCount > 0) {
    visible.push(`- and ${hiddenCount} more`);
  }
  return visible.join('\n');
}

function directOnlyDetail(summary: ActiveQuitSessionSummary): string {
  const count = summary.running;
  const sessionText = count === 1 ? "This session isn't" : "These sessions aren't";
  const pronoun = count === 1 ? 'it' : 'they';
  const stopObject = count === 1 ? 'it' : 'them';
  const list = formatSessionList(summary.nonKeepableSessions);

  const intro = `${sessionText} using tmux, so ${pronoun} can't keep running in the background after ${PRODUCT_NAME} quits.`;
  const action = `Stop ${stopObject} to quit, or cancel to keep working.`;

  return list ? `${intro}\n\n${list}\n\n${action}` : `${intro} ${action}`;
}

function mixedDetail(summary: ActiveQuitSessionSummary, keepable: number, direct: number): string {
  const list = formatSessionList(summary.nonKeepableSessions);
  const intro = `${keepable} ${pluralize(keepable, 'session can', 'sessions can')} be kept in tmux. ${direct} direct ${pluralize(direct, 'session', 'sessions')} will stop if ${PRODUCT_NAME} quits.`;

  return list ? `${intro}\n\n${list}` : intro;
}

export function resolveQuitAgentSessionsDecision(
  summary: ActiveQuitSessionSummary,
  showDialog: ShowQuitDialog
): QuitAgentSessionsDecision {
  if (summary.running <= 0) return { action: 'quit', mode: 'terminate' };

  const keepable = Math.max(0, Math.min(summary.keepable, summary.running));
  const direct = summary.running - keepable;
  const title = `Quit ${PRODUCT_NAME}?`;
  const message = messageFor(summary);

  if (keepable === summary.running) {
    const response = showDialog({
      type: 'question',
      buttons: ['Keep Running', 'Stop Sessions', 'Cancel'],
      defaultId: 0,
      cancelId: 2,
      title,
      message,
      detail: `Keep them running in tmux after ${PRODUCT_NAME} quits, or stop them before exiting.`,
      noLink: true,
    });
    if (response === 0) return { action: 'quit', mode: 'detach' };
    if (response === 1) return { action: 'quit', mode: 'terminate' };
    return { action: 'cancel' };
  }

  if (keepable > 0) {
    const response = showDialog({
      type: 'question',
      buttons: ['Keep tmux Sessions', 'Stop Sessions', 'Cancel'],
      defaultId: 2,
      cancelId: 2,
      title,
      message,
      detail: mixedDetail(summary, keepable, direct),
      noLink: true,
    });
    if (response === 0) return { action: 'quit', mode: 'detach' };
    if (response === 1) return { action: 'quit', mode: 'terminate' };
    return { action: 'cancel' };
  }

  const response = showDialog({
    type: 'question',
    buttons: ['Stop Sessions', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    title,
    message,
    detail: directOnlyDetail(summary),
    noLink: true,
  });
  if (response === 0) return { action: 'quit', mode: 'terminate' };
  return { action: 'cancel' };
}

export function combineActiveSessionSummaries(
  agents: ActiveAgentSessionSummary,
  terminals: ActiveWorkspaceTerminalSessionSummary
): ActiveQuitSessionSummary {
  return {
    running: agents.running + terminals.running,
    keepable: agents.keepable + terminals.keepable,
    agentSessions: agents.running,
    terminalSessions: terminals.running,
    nonKeepableSessions: [...agents.nonKeepableSessions, ...terminals.nonKeepableSessions],
  };
}
