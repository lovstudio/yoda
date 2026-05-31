import { makeAutoObservable, observable, runInAction } from 'mobx';
import type { AgentProviderId } from '@shared/agent-provider-registry';
import {
  agentEventChannel,
  agentSessionExitedChannel,
  isAttentionNotification,
} from '@shared/events/agentEvents';
import { PROJECTLESS_PROJECT_ID } from '@shared/projectless';
import { events } from '@renderer/lib/ipc';
import { PtySession } from '@renderer/lib/pty/pty-session';

export type ProjectlessSessionStatus =
  | 'idle'
  | 'working'
  | 'awaiting-input'
  | 'completed'
  | 'error';

export type ProjectlessSidebarSession = {
  sessionId: string;
  taskId: string;
  conversationId: string;
  title: string;
  cwd: string;
  providerId?: AgentProviderId;
  createdAt: string;
  lastInteractedAt: string;
  status: ProjectlessSessionStatus;
};

export type ProjectlessSessionEventSource = Pick<typeof events, 'on'>;

type ProjectlessSessionIdentity = {
  taskId: string;
  conversationId: string;
};

function parseProjectlessSessionId(sessionId: string): ProjectlessSessionIdentity | null {
  const [projectId, taskId, conversationId, ...extra] = sessionId.split(':');
  if (projectId !== PROJECTLESS_PROJECT_ID || !taskId || !conversationId || extra.length > 0) {
    return null;
  }
  return { taskId, conversationId };
}

export class ProjectlessSessionStore {
  sessions = observable.map<string, ProjectlessSidebarSession>();
  collapsed = false;
  private readonly ptySessions = new Map<string, PtySession>();
  private readonly offAgentEvents: () => void;
  private readonly offSessionExited: () => void;

  constructor(eventSource: ProjectlessSessionEventSource = events) {
    makeAutoObservable(this, {
      sessions: false,
      sortedSessions: true,
    });
    this.offAgentEvents = eventSource.on(agentEventChannel, ({ event }) => {
      if (event.projectId !== PROJECTLESS_PROJECT_ID) return;
      runInAction(() => {
        const session = this.findSession(event.taskId, event.conversationId);
        if (!session) return;
        session.lastInteractedAt = new Date(event.timestamp).toISOString();
        if (event.type === 'notification') {
          if (!isAttentionNotification(event.payload.notificationType)) return;
          session.status = 'awaiting-input';
          return;
        }
        if (event.type === 'stop') {
          session.status = 'completed';
          return;
        }
        if (event.type === 'error') {
          session.status = 'error';
        }
      });
    });
    this.offSessionExited = eventSource.on(agentSessionExitedChannel, (event) => {
      if (event.projectId !== PROJECTLESS_PROJECT_ID) return;
      runInAction(() => {
        const session = this.findSession(event.taskId, event.conversationId);
        if (!session) return;
        if (session.status === 'working') {
          session.status = 'idle';
        }
      });
    });
  }

  get sortedSessions(): ProjectlessSidebarSession[] {
    return Array.from(this.sessions.values()).sort((a, b) => {
      const recency = b.lastInteractedAt.localeCompare(a.lastInteractedAt);
      if (recency !== 0) return recency;
      return b.sessionId.localeCompare(a.sessionId);
    });
  }

  registerSession(params: {
    sessionId: string;
    taskId: string;
    conversationId: string;
    title: string;
    cwd: string;
    providerId?: AgentProviderId;
    createdAt?: string;
  }): void {
    const existing = this.sessions.get(params.sessionId);
    const createdAt = existing?.createdAt ?? params.createdAt ?? new Date().toISOString();
    this.sessions.set(params.sessionId, {
      sessionId: params.sessionId,
      taskId: params.taskId,
      conversationId: params.conversationId,
      title: params.title,
      cwd: params.cwd,
      providerId: params.providerId ?? existing?.providerId,
      createdAt,
      lastInteractedAt: existing?.lastInteractedAt ?? createdAt,
      status: existing?.status ?? 'working',
    });
  }

  registerNavigatedSession(params: {
    sessionId: string;
    title: string;
    cwd: string;
    providerId?: AgentProviderId;
  }): boolean {
    const identity = parseProjectlessSessionId(params.sessionId);
    if (!identity) return false;
    this.registerSession({
      sessionId: params.sessionId,
      taskId: identity.taskId,
      conversationId: identity.conversationId,
      title: params.title,
      cwd: params.cwd,
      providerId: params.providerId,
    });
    return true;
  }

  ensurePtySession(sessionId: string): PtySession {
    let session = this.ptySessions.get(sessionId);
    if (!session) {
      session = new PtySession(sessionId);
      this.ptySessions.set(sessionId, session);
    }
    return session;
  }

  toggleCollapsed(): void {
    this.collapsed = !this.collapsed;
  }

  dispose(): void {
    this.offAgentEvents();
    this.offSessionExited();
    for (const session of this.ptySessions.values()) {
      session.dispose();
    }
    this.ptySessions.clear();
  }

  private findSession(taskId: string, conversationId: string): ProjectlessSidebarSession | null {
    for (const session of this.sessions.values()) {
      if (session.taskId === taskId && session.conversationId === conversationId) return session;
    }
    return null;
  }
}

export const projectlessSessionStore = new ProjectlessSessionStore();
