import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  resolveAgentResumeSession,
  resolveCodexThreadForConversation,
  resolveCodexThreadIdForConversation,
} from './codex-session-id';

describe('resolveCodexThreadIdForConversation', () => {
  const previousCodexHome = process.env.CODEX_HOME;
  let dir: string;
  let statePath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'yoda-codex-session-id-'));
    statePath = join(dir, 'state_5.sqlite');
    process.env.CODEX_HOME = dir;
    createStateDb(statePath);
  });

  afterEach(() => {
    if (previousCodexHome === undefined) {
      delete process.env.CODEX_HOME;
    } else {
      process.env.CODEX_HOME = previousCodexHome;
    }
    rmSync(dir, { recursive: true, force: true });
  });

  it('resolves by Codex title when the Yoda conversation id differs', () => {
    insertThread(statePath, {
      id: 'thread-by-title',
      cwd: '/repo',
      title: 'Matching title',
      createdAtMs: Date.parse('2026-06-04T06:45:37.000Z'),
      updatedAtMs: Date.parse('2026-06-04T06:50:00.000Z'),
    });

    expect(
      resolveCodexThreadIdForConversation({
        conversationId: 'conversation-1',
        cwd: '/repo',
        title: 'Matching title',
        statePath,
      })
    ).toBe('thread-by-title');
  });

  it('resolves by closest Codex creation time when the title has changed', () => {
    insertThread(statePath, {
      id: 'older-thread',
      cwd: '/repo',
      title: 'Older title',
      createdAtMs: Date.parse('2026-06-04T06:41:00.000Z'),
      updatedAtMs: Date.parse('2026-06-04T06:42:00.000Z'),
    });
    insertThread(statePath, {
      id: 'codex-thread',
      cwd: '/repo',
      title: 'Codex renamed this session',
      createdAtMs: Date.parse('2026-06-04T06:45:37.040Z'),
      updatedAtMs: Date.parse('2026-06-04T06:56:25.777Z'),
    });

    expect(
      resolveCodexThreadIdForConversation({
        conversationId: '9d72d411-e873-4215-a92a-ab3440436b74',
        cwd: '/repo',
        title: 'feat-src-renderer-features-tasks-components-task-context-menu',
        createdAt: '2026-06-04 06:45:36',
        statePath,
      })
    ).toBe('codex-thread');
    expect(
      resolveCodexThreadForConversation({
        conversationId: '9d72d411-e873-4215-a92a-ab3440436b74',
        cwd: '/repo',
        title: 'feat-src-renderer-features-tasks-components-task-context-menu',
        createdAt: '2026-06-04 06:45:36',
        statePath,
      })
    ).toEqual({ id: 'codex-thread', title: 'Codex renamed this session' });
  });

  it('resolves an untitled Codex thread by closest creation time', () => {
    insertThread(statePath, {
      id: 'untitled-codex-thread',
      cwd: '/repo',
      title: '',
      createdAtMs: Date.parse('2026-06-04T06:45:37.040Z'),
      updatedAtMs: Date.parse('2026-06-04T06:45:38.000Z'),
    });

    expect(
      resolveAgentResumeSession(
        {
          id: 'conversation-1',
          projectId: 'project-1',
          taskId: 'task-1',
          runtimeId: 'codex',
          title: 'Yoda conversation title',
          createdAt: '2026-06-04 06:45:36',
          lastInteractedAt: null,
          isInitialConversation: true,
        },
        '/repo'
      )
    ).toEqual({
      sessionId: 'untitled-codex-thread',
      sessionTitle: 'Yoda conversation title',
    });
  });

  it('resolves a delayed untitled Codex thread when it is the only later cwd match', () => {
    insertThread(statePath, {
      id: 'delayed-codex-thread',
      cwd: '/repo',
      title: '',
      createdAtMs: Date.parse('2026-06-04T07:06:00.000Z'),
      updatedAtMs: Date.parse('2026-06-04T07:06:01.000Z'),
    });

    expect(
      resolveCodexThreadIdForConversation({
        conversationId: 'conversation-1',
        cwd: '/repo',
        title: 'Yoda conversation title',
        createdAt: '2026-06-04 06:45:36',
        statePath,
      })
    ).toBe('delayed-codex-thread');
  });

  it('resolves a moved-path Codex thread by title prefix and creation time', () => {
    insertThread(statePath, {
      id: 'moved-path-thread',
      cwd: '/old/repo',
      title: 'Build a search service for a long ebook prompt',
      createdAtMs: Date.parse('2026-06-04T06:45:37.040Z'),
      updatedAtMs: Date.parse('2026-06-04T06:56:25.777Z'),
    });

    expect(
      resolveAgentResumeSession(
        {
          id: 'conversation-1',
          projectId: 'project-1',
          taskId: 'task-1',
          runtimeId: 'codex',
          title: 'Build a search service',
          createdAt: '2026-06-04 06:45:36',
          lastInteractedAt: null,
          isInitialConversation: true,
        },
        '/new/repo'
      )
    ).toEqual({
      sessionId: 'moved-path-thread',
      sessionTitle: 'Build a search service for a long ebook prompt',
    });
  });

  it('does not guess a delayed Codex thread when the later cwd match is ambiguous', () => {
    insertThread(statePath, {
      id: 'delayed-codex-thread-1',
      cwd: '/repo',
      title: '',
      createdAtMs: Date.parse('2026-06-04T07:06:00.000Z'),
      updatedAtMs: Date.parse('2026-06-04T07:06:01.000Z'),
    });
    insertThread(statePath, {
      id: 'delayed-codex-thread-2',
      cwd: '/repo',
      title: '',
      createdAtMs: Date.parse('2026-06-04T07:07:00.000Z'),
      updatedAtMs: Date.parse('2026-06-04T07:07:01.000Z'),
    });

    expect(
      resolveCodexThreadIdForConversation({
        conversationId: 'conversation-1',
        cwd: '/repo',
        title: 'Yoda conversation title',
        createdAt: '2026-06-04 06:45:36',
        statePath,
      })
    ).toBeUndefined();
  });

  it('returns the resolved Codex thread title with the resume session id', () => {
    insertThread(statePath, {
      id: 'codex-thread',
      cwd: '/repo',
      title: 'Actual Codex session title',
      createdAtMs: Date.parse('2026-06-04T06:45:37.040Z'),
      updatedAtMs: Date.parse('2026-06-04T06:56:25.777Z'),
    });

    const session = resolveAgentResumeSession(
      {
        id: 'conversation-1',
        projectId: 'project-1',
        taskId: 'task-1',
        runtimeId: 'codex',
        title: 'Stale Yoda conversation title',
        createdAt: '2026-06-04 06:45:36',
        lastInteractedAt: null,
        isInitialConversation: true,
      },
      '/repo'
    );

    expect(session).toEqual({
      sessionId: 'codex-thread',
      sessionTitle: 'Actual Codex session title',
    });
  });

  it('does not resolve a distant thread by creation time', () => {
    insertThread(statePath, {
      id: 'distant-thread',
      cwd: '/repo',
      title: 'Distant title',
      createdAtMs: Date.parse('2026-06-04T07:30:00.000Z'),
      updatedAtMs: Date.parse('2026-06-04T07:40:00.000Z'),
    });

    expect(
      resolveCodexThreadIdForConversation({
        conversationId: 'conversation-1',
        cwd: '/repo',
        title: 'Missing title',
        createdAt: '2026-06-04 06:45:36',
        statePath,
      })
    ).toBeUndefined();
  });

  it('resolves an archived Codex thread by closest creation time', () => {
    insertThread(statePath, {
      id: 'archived-codex-thread',
      cwd: '/repo',
      title: 'Archived Codex session',
      createdAtMs: Date.parse('2026-06-04T06:45:37.040Z'),
      updatedAtMs: Date.parse('2026-06-04T06:56:25.777Z'),
      archived: 1,
    });

    expect(
      resolveCodexThreadForConversation({
        conversationId: 'conversation-1',
        cwd: '/repo',
        title: 'Stale Yoda conversation title',
        createdAt: '2026-06-04 06:45:36',
        statePath,
      })
    ).toEqual({ id: 'archived-codex-thread', title: 'Archived Codex session' });
  });
});

function createStateDb(statePath: string): void {
  const db = new Database(statePath);
  try {
    db.exec(`
      CREATE TABLE threads (
        id TEXT PRIMARY KEY,
        cwd TEXT NOT NULL,
        title TEXT NOT NULL,
        first_user_message TEXT NOT NULL DEFAULT '',
        preview TEXT NOT NULL DEFAULT '',
        archived INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        created_at_ms INTEGER,
        updated_at_ms INTEGER
      );
    `);
  } finally {
    db.close();
  }
}

function insertThread(
  statePath: string,
  args: {
    id: string;
    cwd: string;
    title: string;
    createdAtMs: number;
    updatedAtMs: number;
    archived?: number;
  }
): void {
  const db = new Database(statePath);
  try {
    db.prepare(
      `
        INSERT INTO threads (
          id,
          cwd,
          title,
          first_user_message,
          preview,
          archived,
          created_at,
          updated_at,
          created_at_ms,
          updated_at_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
    ).run(
      args.id,
      args.cwd,
      args.title,
      args.title,
      args.title,
      args.archived ?? 0,
      Math.floor(args.createdAtMs / 1000),
      Math.floor(args.updatedAtMs / 1000),
      args.createdAtMs,
      args.updatedAtMs
    );
  } finally {
    db.close();
  }
}
