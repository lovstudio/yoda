import { afterEach, describe, expect, it, vi } from 'vitest';
import { agentSessionRuntimeStore, type AgentSessionKey } from './agent-session-runtime';

vi.mock('@main/lib/events', () => ({
  events: { emit: vi.fn(), on: vi.fn(() => () => {}) },
}));
vi.mock('./interrupt-marker', () => ({ clearInterruptMarker: vi.fn() }));

const session: AgentSessionKey = {
  projectId: 'project-mobile-events',
  taskId: 'task-mobile-events',
  conversationId: 'conversation-mobile-events',
};

describe('AgentSessionRuntimeStore local subscriptions', () => {
  afterEach(() => {
    agentSessionRuntimeStore.remove(session);
    vi.restoreAllMocks();
  });

  it('notifies a scoped listener only when observable runtime state changes', () => {
    const listener = vi.fn();
    const unsubscribe = agentSessionRuntimeStore.subscribe(session, listener);

    agentSessionRuntimeStore.dispatch(
      session,
      { kind: 'turn-started', at: 1, force: true },
      'renderer:test'
    );
    agentSessionRuntimeStore.dispatch(
      session,
      { kind: 'turn-started', at: 2, force: true },
      'renderer:test'
    );

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0]?.[0]).toMatchObject({ status: 'working' });

    unsubscribe();
    agentSessionRuntimeStore.dispatch(session, { kind: 'turn-completed', at: 3 }, 'renderer:test');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('notifies live subscribers when a running session is removed', () => {
    agentSessionRuntimeStore.setStatus(session, 'working');
    const listener = vi.fn();
    const unsubscribe = agentSessionRuntimeStore.subscribe(session, listener);

    agentSessionRuntimeStore.remove(session);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0]?.[0]).toMatchObject({ status: 'idle' });
    unsubscribe();
  });
});
