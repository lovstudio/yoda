import { eq } from 'drizzle-orm';
import { BrowserWindow, Notification } from 'electron';
import { agentEventRequiresUserAction, type AgentEvent } from '@shared/events/agentEvents';
import {
  notificationCreatedChannel,
  notificationFocusTaskChannel,
  type AppNotificationCreated,
} from '@shared/events/appEvents';
import {
  getAgentNotificationKind,
  shouldShowAgentNotification,
} from '@shared/notification-settings';
import { getRuntime, type RuntimeId } from '@shared/runtime-registry';
import { getMainWindow } from '@main/app/window';
import { appSettingsService } from '@main/core/settings/settings-service';
import { db } from '@main/db/client';
import { tasks } from '@main/db/schema';
import { events } from '@main/lib/events';
import { log } from '@main/lib/logger';

const AGENT_NOTIFICATION_DEDUPE_WINDOW_MS = 3_000;
const recentAgentNotifications = new Map<string, number>();

function suppressDuplicateAgentNotification(event: AgentEvent): boolean {
  if (!event.source) return false;

  const kind = getAgentNotificationKind(event);
  if (!kind) return false;

  const now = Date.now();
  for (const [key, timestamp] of recentAgentNotifications) {
    if (now - timestamp >= AGENT_NOTIFICATION_DEDUPE_WINDOW_MS) {
      recentAgentNotifications.delete(key);
    }
  }

  const key = `${event.conversationId}:${kind}`;
  const previous = recentAgentNotifications.get(key);
  if (previous !== undefined && now - previous < AGENT_NOTIFICATION_DEDUPE_WINDOW_MS) {
    return true;
  }
  recentAgentNotifications.set(key, now);
  return false;
}

function getNotificationMessage(
  event: AgentEvent
): Pick<AppNotificationCreated, 'description' | 'kind' | 'messageKey' | 'reason'> | null {
  if (event.type === 'stop') {
    return {
      description: 'Your agent finished',
      kind: 'success',
    };
  }
  if (!agentEventRequiresUserAction(event)) return null;
  return {
    description: 'Your agent is waiting for input',
    kind: 'info',
    messageKey: 'agentAwaitingInput',
    reason: 'action-required',
  };
}

async function getTaskName(taskId: string | undefined): Promise<string | null> {
  if (!taskId) return null;
  const [row] = await db
    .select({ name: tasks.name })
    .from(tasks)
    .where(eq(tasks.id, taskId))
    .limit(1);
  return row?.name ?? null;
}

export async function maybeShowNotification(event: AgentEvent, appFocused: boolean): Promise<void> {
  try {
    const message = getNotificationMessage(event);
    if (!message) return;
    if (suppressDuplicateAgentNotification(event)) return;

    const runtimeName =
      getRuntime(event.runtimeId as RuntimeId)?.name ?? event.runtimeId ?? 'Agent';
    const taskName = await getTaskName(event.taskId);
    const title = taskName ? `${runtimeName} — ${taskName}` : runtimeName;
    const target = {
      projectId: event.projectId,
      taskId: event.taskId,
      conversationId: event.conversationId,
    };
    events.emit(notificationCreatedChannel, {
      title,
      ...message,
      source: 'agent',
      target,
      details: [
        event.payload.title,
        event.payload.message,
        `Project: ${event.projectId}`,
        `Task: ${event.taskId}`,
        `Session: ${event.conversationId}`,
      ]
        .filter(Boolean)
        .join('\n'),
    });

    const settings = await appSettingsService.get('notifications');
    if (!shouldShowAgentNotification(event, settings, appFocused) || !Notification.isSupported()) {
      return;
    }

    const notification = new Notification({ title, body: message.description, silent: false });

    notification.on('click', () => {
      const win = getMainWindow();
      if (!win || win.isDestroyed()) return;
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
      if (event.taskId) {
        events.emit(notificationFocusTaskChannel, {
          projectId: event.projectId,
          taskId: event.taskId,
          conversationId: event.conversationId,
        });
      }
    });

    notification.show();
  } catch (error) {
    log.warn('notification: failed to show OS notification', { error: String(error) });
  }
}

export function isAppFocused(): boolean {
  const windows = BrowserWindow.getAllWindows();
  return windows.some((w) => !w.isDestroyed() && w.isFocused());
}
