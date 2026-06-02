import { PRODUCT_NAME } from '@shared/app-identity';
import type { ActiveAgentSessionSummary } from '@main/core/tasks/task-manager';
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

function pluralize(count: number, singular: string, plural: string): string {
  return count === 1 ? singular : plural;
}

function messageFor(summary: ActiveAgentSessionSummary): string {
  return summary.running === 1
    ? 'An agent session is still running.'
    : `${summary.running} agent sessions are still running.`;
}

export function resolveQuitAgentSessionsDecision(
  summary: ActiveAgentSessionSummary,
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
      detail: 'Keep them running in tmux after Yoda quits, or stop them before exiting.',
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
      detail: `${keepable} ${pluralize(keepable, 'session can', 'sessions can')} be kept in tmux. ${direct} direct ${pluralize(direct, 'session', 'sessions')} will stop if Yoda quits.`,
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
    detail:
      'These sessions are not running in tmux, so they cannot be kept after Yoda quits. Stop them before exiting or cancel to return to Yoda.',
    noLink: true,
  });
  if (response === 0) return { action: 'quit', mode: 'terminate' };
  return { action: 'cancel' };
}
