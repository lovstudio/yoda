import i18n from '@renderer/lib/i18n';
import { workspaceNotificationStore } from './notification-store';

export type RendererErrorNotificationContext = {
  component?: string;
  operation?: string;
  action?: string;
  errorType?: string;
  severity?: string;
  details?: Record<string, unknown>;
};

export function enqueueRendererErrorNotification(
  error: Error,
  context: RendererErrorNotificationContext = {}
): string {
  const fingerprint = [
    context.component,
    context.operation,
    context.action,
    context.errorType,
    error.name,
    error.message,
  ].join('\0');
  const contextDetails = {
    component: context.component,
    operation: context.operation,
    action: context.action,
    errorType: context.errorType,
    severity: context.severity,
    ...context.details,
  };
  const cleanContext = Object.fromEntries(
    Object.entries(contextDetails).filter(([, value]) => value !== undefined)
  );
  const details = [
    `${error.name}: ${error.message}`,
    error.stack ? `Stack:\n${error.stack}` : null,
    Object.keys(cleanContext).length > 0
      ? `Context:\n${JSON.stringify(cleanContext, null, 2)}`
      : null,
  ]
    .filter((part): part is string => Boolean(part))
    .join('\n\n');

  return workspaceNotificationStore.enqueue({
    title: i18n.t('workspaceRuntime.notifications.programErrorTitle'),
    description: error.message,
    details,
    kind: 'error',
    source: 'system',
    reason: 'error',
    dedupeKey: `renderer-error:${fingerprint}`,
  });
}
