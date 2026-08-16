export type NotificationReason =
  | 'action-required'
  | 'error'
  | 'blocking-warning'
  | 'subscribed-result';

export type NotificationStatus = 'active' | 'resolved';

/**
 * Who reported the notification. These are producers, not transports — an entry
 * is classified by the subsystem it came from, never by whether a toast happened
 * to carry it, so the same failure always lands in the same bucket.
 */
export const NOTIFICATION_SOURCES = ['app', 'agent', 'automation'] as const;

export type NotificationSource = (typeof NOTIFICATION_SOURCES)[number];

export type NotificationCenterSources = Record<NotificationSource, boolean>;

/**
 * Which producers the notification center keeps by default. Agent sessions are
 * off because the task sidebar already shows the same state and offers the
 * actions for it — a retained copy would be pure duplication. Users who want
 * that history back can switch it on from the center's own menu.
 */
export const DEFAULT_NOTIFICATION_CENTER_SOURCES: NotificationCenterSources = {
  app: true,
  agent: false,
  automation: true,
};

/**
 * `toast` and `system` used to split app-reported entries by which layer caught
 * the failure, which no reader could predict. Both now read as `app`.
 */
export function normalizeNotificationSource(value: unknown): NotificationSource | null {
  if (value === 'toast' || value === 'system') return 'app';
  return NOTIFICATION_SOURCES.find((source) => source === value) ?? null;
}
