import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '@main/db/schema';

const state = vi.hoisted(() => ({
  db: null as unknown,
}));

vi.mock('@main/db/client', () => ({
  get db() {
    return state.db;
  },
}));

vi.mock('@main/core/projects/project-manager', () => ({
  projectManager: { getProject: vi.fn() },
}));

describe('PrQueryService project task snapshots', () => {
  let sqlite: Database.Database;

  beforeEach(() => {
    vi.resetModules();
    sqlite = new Database(':memory:');
    createSchema(sqlite);
    seedTasks(sqlite);
    state.db = drizzle(sqlite, { schema });
  });

  afterEach(() => {
    sqlite.close();
    state.db = null;
  });

  it('loads all cached PRs for active project tasks from only the selected remote', async () => {
    insertPullRequest(sqlite, {
      url: 'https://github.com/lovstudio/yoda/pull/1',
      repositoryUrl: 'https://github.com/lovstudio/yoda',
      headRefName: 'feature/shared',
      identifier: '#1',
    });
    insertPullRequest(sqlite, {
      url: 'https://github.com/lovstudio/yoda/pull/2',
      repositoryUrl: 'https://github.com/lovstudio/yoda',
      headRefName: 'feature/shared',
      identifier: '#2',
    });
    insertPullRequest(sqlite, {
      url: 'https://github.com/other/yoda/pull/3',
      repositoryUrl: 'https://github.com/other/yoda',
      headRefName: 'feature/shared',
      identifier: '#3',
    });
    sqlite.exec(`
      INSERT INTO pull_request_users (user_id, user_name, display_name)
      VALUES ('user-1', 'mark', 'Mark');
      UPDATE pull_requests
      SET author_user_id = 'user-1'
      WHERE url = 'https://github.com/lovstudio/yoda/pull/1';
      INSERT INTO pull_request_labels (pull_request_id, name, color)
      VALUES ('https://github.com/lovstudio/yoda/pull/1', 'performance', '00ff00');
      INSERT INTO pull_request_assignees (pull_request_url, user_id)
      VALUES ('https://github.com/lovstudio/yoda/pull/1', 'user-1');
      INSERT INTO pull_request_checks (
        id, pull_request_url, commit_sha, name, status, conclusion
      ) VALUES (
        'check-1', 'https://github.com/lovstudio/yoda/pull/1', 'head',
        'test', 'COMPLETED', 'SUCCESS'
      );
    `);

    const { PrQueryService } = await import('./pr-query-service');
    const snapshots = await new PrQueryService().getProjectTaskPullRequests(
      'project-1',
      'https://github.com/lovstudio/yoda'
    );

    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]?.taskId).toBe('active-task');
    expect(snapshots[0]?.prs.map((pr) => pr.url).sort()).toEqual([
      'https://github.com/lovstudio/yoda/pull/1',
      'https://github.com/lovstudio/yoda/pull/2',
    ]);
    expect(snapshots[0]?.prs.find((pr) => pr.identifier === '#1')).toMatchObject({
      author: { userId: 'user-1' },
      labels: [{ name: 'performance', color: '00ff00' }],
      assignees: [{ userId: 'user-1' }],
      checks: [{ id: 'check-1', conclusion: 'SUCCESS' }],
    });
  });
});

function createSchema(sqlite: Database.Database): void {
  sqlite.exec(`
    CREATE TABLE tasks (
      id TEXT PRIMARY KEY NOT NULL,
      project_id TEXT NOT NULL,
      task_branch TEXT,
      archived_at TEXT
    );
    CREATE TABLE pull_request_users (
      user_id TEXT PRIMARY KEY NOT NULL,
      user_name TEXT NOT NULL,
      display_name TEXT,
      avatar_url TEXT,
      url TEXT,
      user_updated_at TEXT,
      user_created_at TEXT
    );
    CREATE TABLE pull_requests (
      url TEXT PRIMARY KEY NOT NULL,
      provider TEXT DEFAULT 'github' NOT NULL,
      repository_url TEXT NOT NULL,
      base_ref_name TEXT NOT NULL,
      base_ref_oid TEXT NOT NULL,
      head_repository_url TEXT NOT NULL,
      head_ref_name TEXT NOT NULL,
      head_ref_oid TEXT NOT NULL,
      identifier TEXT,
      title TEXT NOT NULL,
      description TEXT,
      status TEXT DEFAULT 'open' NOT NULL,
      is_draft INTEGER,
      author_user_id TEXT,
      additions INTEGER,
      deletions INTEGER,
      changed_files INTEGER,
      commit_count INTEGER,
      mergeable_status TEXT,
      merge_state_status TEXT,
      review_decision TEXT,
      pull_request_created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
      pull_request_updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    );
    CREATE TABLE pull_request_labels (
      pull_request_id TEXT NOT NULL,
      name TEXT NOT NULL,
      color TEXT,
      PRIMARY KEY (pull_request_id, name)
    );
    CREATE TABLE pull_request_assignees (
      pull_request_url TEXT NOT NULL,
      user_id TEXT NOT NULL,
      PRIMARY KEY (pull_request_url, user_id)
    );
    CREATE TABLE pull_request_checks (
      id TEXT PRIMARY KEY NOT NULL,
      pull_request_url TEXT NOT NULL,
      commit_sha TEXT NOT NULL,
      name TEXT NOT NULL,
      status TEXT NOT NULL,
      conclusion TEXT,
      details_url TEXT,
      started_at TEXT,
      completed_at TEXT,
      workflow_name TEXT,
      app_name TEXT,
      app_logo_url TEXT
    );
  `);
}

function seedTasks(sqlite: Database.Database): void {
  sqlite.exec(`
    INSERT INTO tasks (id, project_id, task_branch, archived_at) VALUES
      ('active-task', 'project-1', 'feature/shared', NULL),
      ('archived-task', 'project-1', 'feature/shared', '2026-06-06T10:00:00.000Z'),
      ('no-pr-task', 'project-1', 'feature/none', NULL),
      ('null-branch-task', 'project-1', NULL, NULL),
      ('other-project-task', 'project-2', 'feature/shared', NULL);
  `);
}

function insertPullRequest(
  sqlite: Database.Database,
  params: {
    url: string;
    repositoryUrl: string;
    headRefName: string;
    identifier: string;
  }
): void {
  sqlite
    .prepare(
      `INSERT INTO pull_requests (
        url, repository_url, base_ref_name, base_ref_oid,
        head_repository_url, head_ref_name, head_ref_oid, identifier, title
      ) VALUES (?, ?, 'main', 'base', ?, ?, 'head', ?, ?)`
    )
    .run(
      params.url,
      params.repositoryUrl,
      params.repositoryUrl,
      params.headRefName,
      params.identifier,
      `Pull request ${params.identifier}`
    );
}
