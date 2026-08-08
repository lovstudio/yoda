import { afterEach, describe, expect, it } from 'vitest';
import { runtimeStatusMonitorRegistry } from './runtime-status-monitor-registry';

describe('runtimeStatusMonitorRegistry', () => {
  const conversationId = 'conversation-1';

  afterEach(() => runtimeStatusMonitorRegistry.remove(conversationId));

  it('preserves legacy sources for sessions not registered by the local provider', () => {
    expect(runtimeStatusMonitorRegistry.accepts(conversationId, 'hooks')).toBe(true);
  });

  it('accepts only the monitor fixed for the live session', () => {
    runtimeStatusMonitorRegistry.set(conversationId, 'activity');

    expect(runtimeStatusMonitorRegistry.accepts(conversationId, 'activity')).toBe(true);
    expect(runtimeStatusMonitorRegistry.accepts(conversationId, 'hooks')).toBe(false);
    expect(runtimeStatusMonitorRegistry.accepts(conversationId, 'transcript')).toBe(false);
  });
});
