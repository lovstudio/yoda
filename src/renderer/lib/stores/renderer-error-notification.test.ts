import { beforeEach, describe, expect, it } from 'vitest';
import i18n from '@renderer/lib/i18n';
import { workspaceNotificationStore } from './notification-store';
import { enqueueRendererErrorNotification } from './renderer-error-notification';

describe('enqueueRendererErrorNotification', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
    workspaceNotificationStore.clear();
  });

  it('retains debug details and coalesces repeated renderer errors', () => {
    const error = new TypeError('render failed');
    const context = {
      component: 'WorkspaceView',
      errorType: 'render_error',
      severity: 'high',
      details: { task_id: 'task-1' },
    };

    enqueueRendererErrorNotification(error, context);
    enqueueRendererErrorNotification(error, context);

    expect(workspaceNotificationStore.getSnapshot()).toHaveLength(1);
    expect(workspaceNotificationStore.getSnapshot()[0]).toMatchObject({
      title: 'Application error',
      description: 'render failed',
      kind: 'error',
      source: 'app',
      reason: 'error',
      occurrenceCount: 2,
    });
    expect(workspaceNotificationStore.getSnapshot()[0].details).toContain('WorkspaceView');
    expect(workspaceNotificationStore.getSnapshot()[0].details).toContain('task-1');
  });
});
