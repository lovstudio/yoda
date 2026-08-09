import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '@main/db/schema';
import { makeTmuxSessionName, type TmuxSessionMarker } from './tmux-session-name';

const state = vi.hoisted(() => ({
  db: null as unknown,
  resolveStatuses: vi.fn(),
}));

vi.mock('@main/db/client', () => ({
  get db() {
    return state.db;
  },
}));

vi.mock('@main/core/pty/pty-session-registry', () => ({
  ptySessionRegistry: { getDiagnostics: vi.fn(() => null) },
}));

vi.mock('@main/core/conversations/cold-conversation-reclamation', () => ({
  resolveColdConversationReclamationStatuses: state.resolveStatuses,
}));

describe('tmux persistent owner inventory', () => {
  let sqlite: Database.Database;

  beforeEach(() => {
    vi.resetModules();
    sqlite = new Database(':memory:');
    sqlite.exec(`
      CREATE TABLE projects (id TEXT PRIMARY KEY, archived_at TEXT);
      CREATE TABLE tasks (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        archived_at TEXT
      );
      CREATE TABLE conversations (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        title TEXT NOT NULL DEFAULT '',
        provider TEXT,
        config TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        archived_at TEXT
      );
      CREATE TABLE terminals (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        task_id TEXT NOT NULL
      );
      CREATE TABLE workspace_terminals (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        scope_id TEXT NOT NULL
      );
      INSERT INTO projects VALUES ('active-project', NULL), ('archived-project', '2026-08-01');
      INSERT INTO tasks VALUES
        ('active-task', 'active-project', NULL),
        ('archived-task', 'active-project', '2026-08-02'),
        ('project-archived-task', 'archived-project', NULL),
        ('foreign-task', 'archived-project', NULL);
      INSERT INTO conversations
        (id, project_id, task_id, title, provider, config, archived_at)
      VALUES
        ('active-conversation', 'active-project', 'active-task', 'Active', 'codex', NULL, NULL),
        ('archived-conversation', 'active-project', 'active-task', 'Archived', 'codex', NULL, '2026-08-03'),
        ('task-archived-conversation', 'active-project', 'archived-task', 'Task archived', 'codex', NULL, NULL),
        ('mismatched-conversation', 'active-project', 'foreign-task', 'Broken', 'codex', NULL, NULL);
      INSERT INTO terminals VALUES
        ('task-terminal', 'active-project', 'active-task'),
        ('archived-task-terminal', 'archived-project', 'project-archived-task'),
        ('mismatched-terminal', 'active-project', 'foreign-task');
      INSERT INTO workspace_terminals VALUES
        ('workspace-terminal', 'active-project', 'local:active-project:project-view'),
        ('archived-workspace-terminal', 'archived-project', 'local:archived-project:project-view');
    `);
    state.db = drizzle(sqlite, { schema });
    state.resolveStatuses.mockReset();
    state.resolveStatuses.mockResolvedValue(new Map());
  });

  afterEach(() => {
    sqlite.close();
    state.db = null;
  });

  it('reconstructs exact IDs and inherits archive state from every owner layer', async () => {
    const { loadTmuxPersistentOwners } = await import('./tmux-reclamation');
    const owners = await loadTmuxPersistentOwners();

    expect(owners.get('active-project:active-task:active-conversation')).toEqual({
      kind: 'conversation',
      id: 'active-conversation',
      state: 'active',
    });
    expect(owners.get('active-project:active-task:archived-conversation')?.state).toBe('archived');
    expect(owners.get('active-project:archived-task:task-archived-conversation')?.state).toBe(
      'archived'
    );
    expect(owners.get('active-project:foreign-task:mismatched-conversation')).toEqual({
      kind: 'conversation',
      id: 'mismatched-conversation',
      state: 'active',
      protected: true,
    });
    expect(owners.get('archived-project:project-archived-task:archived-task-terminal')?.state).toBe(
      'archived'
    );
    expect(owners.get('active-project:foreign-task:mismatched-terminal')).toEqual({
      kind: 'task-terminal',
      id: 'mismatched-terminal',
      state: 'active',
      protected: true,
    });
    expect(
      owners.get('active-project:local:active-project:project-view:workspace-terminal')
    ).toEqual({
      kind: 'workspace-terminal',
      id: 'workspace-terminal',
      state: 'active',
    });
    expect(
      owners.get('archived-project:local:archived-project:project-view:archived-workspace-terminal')
        ?.state
    ).toBe('archived');
  });

  it('attaches durable status to archived conversations and passes marker identity evidence', async () => {
    const sessionId = 'active-project:active-task:archived-conversation';
    const marker: TmuxSessionMarker = {
      sessionName: makeTmuxSessionName(sessionId),
      cwd: '/repo/worktree',
      panePid: 4321,
      createdAtMs: 1_000,
      lastActivityAtMs: 2_000,
      attachedClients: 0,
    };
    state.resolveStatuses.mockResolvedValue(new Map([[sessionId, 'idle']]));
    const { loadTmuxPersistentOwners } = await import('./tmux-reclamation');

    const owners = await loadTmuxPersistentOwners([marker]);

    expect(owners.get(sessionId)).toEqual({
      kind: 'conversation',
      id: 'archived-conversation',
      state: 'archived',
      coldStatus: 'idle',
    });
    expect(state.resolveStatuses).toHaveBeenCalledWith([
      expect.objectContaining({
        sessionId,
        processPid: 4321,
        markerCreatedAtMs: 1_000,
      }),
    ]);
  });
});
