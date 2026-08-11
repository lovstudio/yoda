import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { agentEventChannel } from '@shared/events/agentEvents';
import { agentSessionRuntimeStore, type AgentSessionKey } from './agent-session-runtime';

const mocks = vi.hoisted(() => ({
  emit: vi.fn(),
  isAppFocused: vi.fn(() => false),
  maybeShowNotification: vi.fn(),
}));

vi.mock('@main/lib/events', () => ({
  events: { emit: mocks.emit, on: vi.fn(() => () => {}) },
}));
vi.mock('@main/core/agent-hooks/notification', () => ({
  isAppFocused: mocks.isAppFocused,
  maybeShowNotification: mocks.maybeShowNotification,
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

  it('turns authoritative completion into a notification event and sound signal', () => {
    agentSessionRuntimeStore.dispatch(
      session,
      { kind: 'turn-started', at: 100, force: true },
      'codex-rollout'
    );
    agentSessionRuntimeStore.dispatch(
      session,
      { kind: 'turn-completed', at: 200 },
      'codex-rollout'
    );

    expect(mocks.maybeShowNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'stop',
        source: 'runtime',
        projectId: session.projectId,
        taskId: session.taskId,
        conversationId: session.conversationId,
        timestamp: 200,
      }),
      false
    );
    expect(mocks.emit).toHaveBeenCalledWith(
      agentEventChannel,
      expect.objectContaining({
        appFocused: false,
        event: expect.objectContaining({ type: 'stop', source: 'runtime' }),
      })
    );
  });

  it('preserves the permission subtype for authoritative attention events', () => {
    agentSessionRuntimeStore.dispatch(
      session,
      {
        kind: 'awaiting-input',
        at: 300,
        pendingAction: {
          notificationType: 'permission_prompt',
          toolName: 'shell',
          actionDescription: 'Allow this command?',
        },
      },
      'claude-transcript'
    );

    expect(mocks.maybeShowNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'notification',
        source: 'runtime',
        payload: expect.objectContaining({
          notificationType: 'permission_prompt',
          title: 'shell',
          message: 'Allow this command?',
        }),
      }),
      false
    );
  });
});

describe('AgentSessionRuntimeStore watchdog', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    agentSessionRuntimeStore.initialize();
  });

  afterEach(() => {
    agentSessionRuntimeStore.dispose();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it.each(['codex-rollout', 'claude-transcript', 'claude-session-activity'])(
    'does not clear a long-running turn backed by %s',
    (source) => {
      agentSessionRuntimeStore.dispatch(
        session,
        { kind: 'turn-started', at: 0, force: true },
        source
      );

      vi.advanceTimersByTime(31 * 60_000);

      expect(agentSessionRuntimeStore.getStatus(session)).toBe('working');
    }
  );

  it('does not carry authoritative protection into a later heuristic turn', () => {
    agentSessionRuntimeStore.dispatch(
      session,
      { kind: 'turn-started', at: 0, force: true },
      'codex-rollout'
    );
    agentSessionRuntimeStore.dispatch(session, { kind: 'turn-completed', at: 1 }, 'codex-rollout');
    agentSessionRuntimeStore.dispatch(
      session,
      { kind: 'turn-started', at: 2, force: true },
      'renderer:test'
    );

    vi.advanceTimersByTime(31 * 60_000);

    expect(agentSessionRuntimeStore.getStatus(session)).toBe('idle');
  });

  it('still clears a stale heuristic working state', () => {
    agentSessionRuntimeStore.dispatch(
      session,
      { kind: 'turn-started', at: 0, force: true },
      'renderer:test'
    );

    vi.advanceTimersByTime(31 * 60_000);

    expect(agentSessionRuntimeStore.getStatus(session)).toBe('idle');
  });
});
