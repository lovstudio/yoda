import { eq } from 'drizzle-orm';
import { BrowserWindow, Notification } from 'electron';
import { agentEventRequiresUserAction, type AgentEvent } from '@shared/events/agentEvents';
import { notificationFocusTaskChannel } from '@shared/events/appEvents';
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

function getNotificationBody(event: AgentEvent): string | null {
  if (event.type === 'stop') return 'Your agent finished';
  if (!agentEventRequiresUserAction(event)) return null;
  return 'Your agent is waiting for input';
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

/**
 * Agent lifecycle events only ever raise an OS notification. They deliberately
 * do not feed the in-app notification center: the task sidebar already shows the
 * same session state and offers the actions for it, so a retained copy would be
 * pure duplication.
 */
export async function maybeShowNotification(event: AgentEvent, appFocused: boolean): Promise<void> {
  try {
    const body = getNotificationBody(event);
    if (!body) return;
    if (suppressDuplicateAgentNotification(event)) return;

    const settings = await appSettingsService.get('notifications');
    if (!shouldShowAgentNotification(event, settings, appFocused) || !Notification.isSupported()) {
      return;
    }

    const runtimeName =
      getRuntime(event.runtimeId as RuntimeId)?.name ?? event.runtimeId ?? 'Agent';
    const taskName = await getTaskName(event.taskId);
    const title = taskName ? `${runtimeName} — ${taskName}` : runtimeName;
    const notification = new Notification({ title, body, silent: false });

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
