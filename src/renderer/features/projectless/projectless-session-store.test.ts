import { describe, expect, it, vi } from 'vitest';
import { agentEventChannel, agentSessionExitedChannel } from '@shared/events/agentEvents';
import { PROJECTLESS_PROJECT_ID } from '@shared/projectless';
import {
  ProjectlessSessionStore,
  type ProjectlessSessionEventSource,
} from './projectless-session-store';

const ipcMocks = vi.hoisted(() => ({
  eventOn: vi.fn(() => vi.fn()),
}));

vi.mock('@renderer/lib/ipc', () => ({
  events: {
    on: ipcMocks.eventOn,
  },
}));

vi.mock('@renderer/lib/pty/pty-session', () => ({
  PtySession: class {
    pty = null;
    status = 'disconnected';

    constructor(readonly sessionId: string) {}

    connect = vi.fn();
    dispose = vi.fn();
  },
}));

function makeEventSource() {
  const listeners = new Map<string, (data: unknown) => void>();
  return {
    listeners,
    eventSource: {
      on: vi.fn((event: { name: string }, cb: (data: unknown) => void) => {
        listeners.set(event.name, cb);
        return vi.fn();
      }),
    } as unknown as ProjectlessSessionEventSource,
  };
}

describe('ProjectlessSessionStore', () => {
  it('registers projectless sessions newest first', () => {
    const { eventSource } = makeEventSource();
    const store = new ProjectlessSessionStore(eventSource);

    store.registerSession({
      sessionId: 'session-1',
      taskId: 'task-1',
      conversationId: 'conversation-1',
      title: 'First',
      cwd: '/tmp/first',
      createdAt: '2026-05-01T00:00:00.000Z',
    });
    store.registerSession({
      sessionId: 'session-2',
      taskId: 'task-2',
      conversationId: 'conversation-2',
      title: 'Second',
      cwd: '/tmp/second',
      createdAt: '2026-05-02T00:00:00.000Z',
    });

    expect(store.sortedSessions.map((session) => session.sessionId)).toEqual([
      'session-2',
      'session-1',
    ]);
  });

  it('toggles the projectless sidebar group collapsed state', () => {
    const { eventSource } = makeEventSource();
    const store = new ProjectlessSessionStore(eventSource);

    expect(store.collapsed).toBe(false);
    store.toggleCollapsed();
    expect(store.collapsed).toBe(true);
  });

  it('registers a projectless session from navigated view params', () => {
    const { eventSource } = makeEventSource();
    const store = new ProjectlessSessionStore(eventSource);

    const registered = store.registerNavigatedSession({
      sessionId: `${PROJECTLESS_PROJECT_ID}:task-1:conversation-1`,
      title: 'Navigated Session',
      cwd: '/tmp/navigated',
      providerId: 'codex',
    });

    expect(registered).toBe(true);
    expect(store.sessions.get(`${PROJECTLESS_PROJECT_ID}:task-1:conversation-1`)).toMatchObject({
      taskId: 'task-1',
      conversationId: 'conversation-1',
      title: 'Navigated Session',
      cwd: '/tmp/navigated',
      providerId: 'codex',
    });

    store.registerNavigatedSession({
      sessionId: `${PROJECTLESS_PROJECT_ID}:task-1:conversation-1`,
      title: 'Navigated Session',
      cwd: '/tmp/navigated',
    });

    expect(store.sessions.get(`${PROJECTLESS_PROJECT_ID}:task-1:conversation-1`)).toMatchObject({
      providerId: 'codex',
    });
  });

  it('ignores non-projectless navigated session ids', () => {
    const { eventSource } = makeEventSource();
    const store = new ProjectlessSessionStore(eventSource);

    const registered = store.registerNavigatedSession({
      sessionId: 'project-1:task-1:conversation-1',
      title: 'Project Session',
      cwd: '/tmp/project',
    });

    expect(registered).toBe(false);
    expect(store.sortedSessions).toEqual([]);
  });

  it('updates projectless session status from agent events', () => {
    const { eventSource, listeners } = makeEventSource();
    const store = new ProjectlessSessionStore(eventSource);
    store.registerSession({
      sessionId: 'session-1',
      taskId: 'task-1',
      conversationId: 'conversation-1',
      title: 'Session',
      cwd: '/tmp/session',
      createdAt: '2026-05-01T00:00:00.000Z',
    });

    listeners.get(agentEventChannel.name)?.({
      appFocused: true,
      event: {
        type: 'notification',
        projectId: PROJECTLESS_PROJECT_ID,
        taskId: 'task-1',
        conversationId: 'conversation-1',
        timestamp: Date.parse('2026-05-03T00:00:00.000Z'),
        payload: { notificationType: 'permission_prompt' },
      },
    });
    expect(store.sessions.get('session-1')?.status).toBe('awaiting-input');

    listeners.get(agentEventChannel.name)?.({
      appFocused: true,
      event: {
        type: 'stop',
        projectId: PROJECTLESS_PROJECT_ID,
        taskId: 'task-1',
        conversationId: 'conversation-1',
        timestamp: Date.parse('2026-05-03T00:01:00.000Z'),
        payload: {},
      },
    });
    expect(store.sessions.get('session-1')?.status).toBe('completed');
  });

  it('clears working status when a projectless session exits without a stop event', () => {
    const { eventSource, listeners } = makeEventSource();
    const store = new ProjectlessSessionStore(eventSource);
    store.registerSession({
      sessionId: 'session-1',
      taskId: 'task-1',
      conversationId: 'conversation-1',
      title: 'Session',
      cwd: '/tmp/session',
      createdAt: '2026-05-01T00:00:00.000Z',
    });

    listeners.get(agentSessionExitedChannel.name)?.({
      projectId: PROJECTLESS_PROJECT_ID,
      sessionId: 'session-1',
      taskId: 'task-1',
      conversationId: 'conversation-1',
      exitCode: 0,
    });

    expect(store.sessions.get('session-1')?.status).toBe('idle');
  });
});
