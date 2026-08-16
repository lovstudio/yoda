export type NotificationReason =
  | 'action-required'
  | 'error'
  | 'blocking-warning'
  | 'subscribed-result';

export type NotificationStatus = 'active' | 'resolved';

/** Every producer that can feed the in-app notification center. */
export const NOTIFICATION_SOURCES = ['toast', 'agent', 'automation', 'system'] as const;

export type NotificationSource = (typeof NOTIFICATION_SOURCES)[number];

export type NotificationCenterSources = Record<NotificationSource, boolean>;

/**
 * Which producers the notification center keeps by default. Agent sessions are
 * off because the task sidebar already shows the same state and offers the
 * actions for it — a retained copy would be pure duplication. Users who want
 * that history back can switch it on from the center's own menu.
 */
export const DEFAULT_NOTIFICATION_CENTER_SOURCES: NotificationCenterSources = {
  toast: true,
  agent: false,
  automation: true,
  system: true,
};
