import { describe, expect, it } from 'vitest';
import { agentEventRequiresUserAction } from './agentEvents';

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
