import { describe, expect, it } from 'vitest';
import { agentEventRequiresUserAction } from './agentEvents';
import { shouldRetainAppNotification } from './appEvents';

describe('agentEventRequiresUserAction', () => {
  it('keeps only agent events that are waiting on the user', () => {
    expect(agentEventRequiresUserAction({ type: 'awaiting-input', payload: {} })).toBe(true);
    expect(
      agentEventRequiresUserAction({
        type: 'notification',
        payload: { notificationType: 'permission_prompt' },
      })
    ).toBe(true);
    expect(agentEventRequiresUserAction({ type: 'stop', payload: {} })).toBe(false);
    expect(
      agentEventRequiresUserAction({
        type: 'notification',
        payload: { notificationType: 'auth_success' },
      })
    ).toBe(false);
  });
});

describe('shouldRetainAppNotification', () => {
  it('retains errors and action-required events while dropping informational events', () => {
    expect(shouldRetainAppNotification({ kind: 'error' })).toBe(true);
    expect(shouldRetainAppNotification({ kind: 'info', reason: 'action-required' })).toBe(true);
    expect(shouldRetainAppNotification({ kind: 'success' })).toBe(false);
    expect(shouldRetainAppNotification({ kind: 'info', reason: 'blocking-warning' })).toBe(true);
    expect(shouldRetainAppNotification({ kind: 'success', reason: 'subscribed-result' })).toBe(
      true
    );
    expect(shouldRetainAppNotification({ kind: 'success', status: 'resolved' })).toBe(true);
  });
});
