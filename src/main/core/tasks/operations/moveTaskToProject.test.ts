import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocalExecutionContext } from '@main/core/execution-context/local-execution-context';
import type { IExecutionContext } from '@main/core/execution-context/types';
import { LocalFileSystem } from '@main/core/fs/impl/local-fs';
import { moveTaskToProject } from './moveTaskToProject';

const mocks = vi.hoisted(() => ({
  getProjectMock: vi.fn(),
  openProjectMock: vi.fn(),
  getProjectByIdMock: vi.fn(),
  teardownTaskMock: vi.fn(),
  selectMock: vi.fn(),
  updateMock: vi.fn(),
  taskUpdatedEmitMock: vi.fn(),
  telemetryCaptureMock: vi.fn(),
}));

vi.mock('@main/core/projects/project-manager', () => ({
  projectManager: {
    getProject: mocks.getProjectMock,
    openProject: mocks.openProjectMock,
  },
}));

vi.mock('@main/core/projects/operations/getProjects', () => ({
  getProjectById: mocks.getProjectByIdMock,
}));

vi.mock('@main/core/tasks/task-manager', () => ({
  taskManager: {
    teardownTask: mocks.teardownTaskMock,
  },
}));

vi.mock('@main/db/client', () => ({
  db: {
    select: mocks.selectMock,
    update: mocks.updateMock,
  },
}));

vi.mock('@main/core/tasks/task-events', () => ({
  taskEvents: {
    _emit: mocks.taskUpdatedEmitMock,
  },
}));

vi.mock('@main/lib/telemetry', () => ({
  telemetryService: {
    capture: mocks.telemetryCaptureMock,
  },
}));

type SelectResult = unknown[];

const baseTaskRow = {
  id: 'task-1',
  projectId: 'source-project',
  name: 'Move me',
  status: 'in_progress',
  sourceBranch: { type: 'local', branch: 'main' },
  taskBranch: 'task/ssh-support',
  linkedIssue: null,
  archivedAt: null,
  archiveNote: null,
  archiveRequestedAt: null,
  createdAt: '2026-07-08T00:00:00.000Z',
  updatedAt: '2026-07-08T00:00:00.000Z',
  lastInteractedAt: null,
  statusChangedAt: '2026-07-08T00:00:00.000Z',
  isPinned: 0,
  needsReview: 0,
  isUserNamed: 0,
  setupStatus: 'ready',
  setupError: null,
  setupData: null,
  workspaceProvider: null,
  workspaceId: 'workspace-1',
  workspaceProviderData: null,
  sidebarWorkspaceId: null,
  parentTaskId: null,
  diffAdditions: null,
  diffDeletions: null,
  diffCapturedAt: null,
};

async function git(cwd: string, args: string[]): Promise<string> {
  const ctx = new LocalExecutionContext({ root: cwd });
  const { stdout } = await ctx.exec('git', args);
  return stdout;
}

async function initRepo(repoPath: string): Promise<void> {
  await git(repoPath, ['init']);
  await git(repoPath, ['symbolic-ref', 'HEAD', 'refs/heads/main']);
  await git(repoPath, ['config', 'user.email', 'test@example.com']);
  await git(repoPath, ['config', 'user.name', 'Test User']);
  fs.writeFileSync(path.join(repoPath, 'README.md'), '# test\n');
  await git(repoPath, ['add', 'README.md']);
  await git(repoPath, ['commit', '-m', 'init']);
}

function makeSshLikeCtx(repoPath: string): IExecutionContext {
  const local = new LocalExecutionContext({ root: repoPath });
  return {
    root: local.root,
    supportsLocalSpawn: false,
    exec: local.exec.bind(local),
    execStreaming: local.execStreaming.bind(local),
    dispose: local.dispose.bind(local),
  };
}

function makeProvider(id: string, repoPath: string) {
  return {
    type: 'ssh',
    projectId: id,
    repoPath,
    ctx: makeSshLikeCtx(repoPath),
    fs: new LocalFileSystem(repoPath),
    getWorktreeForBranch: vi.fn().mockResolvedValue(undefined),
  };
}

function setupDb(selectResults: SelectResult[]): void {
  mocks.selectMock.mockImplementation(() => ({
    from: () => ({
      where: () => ({
        limit: async () => selectResults.shift() ?? [],
      }),
    }),
  }));
  mocks.updateMock.mockImplementation(() => ({
    set: () => ({
      where: async () => undefined,
    }),
  }));
}

describe('moveTaskToProject', () => {
  let tempDir: string;
  let sourceRepo: string;
  let targetRepo: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'move-task-'));
    sourceRepo = path.join(tempDir, 'source');
    targetRepo = path.join(tempDir, 'target');
    fs.mkdirSync(sourceRepo);
    fs.mkdirSync(targetRepo);
    await initRepo(sourceRepo);
    await initRepo(targetRepo);

    await git(sourceRepo, ['checkout', '-b', 'task/ssh-support']);
    fs.writeFileSync(path.join(sourceRepo, 'feature.txt'), 'migrated over ssh-like transport\n');
    await git(sourceRepo, ['add', 'feature.txt']);
    await git(sourceRepo, ['commit', '-m', 'feature']);
    await git(sourceRepo, ['checkout', 'main']);

    const sourceProvider = makeProvider('source-project', sourceRepo);
    const targetProvider = makeProvider('target-project', targetRepo);
    mocks.getProjectMock.mockImplementation((id: string) => {
      if (id === 'source-project') return sourceProvider;
      if (id === 'target-project') return targetProvider;
      return undefined;
    });
    mocks.getProjectByIdMock.mockResolvedValue({
      type: 'ssh',
      id: 'target-project',
      name: 'Target',
      alias: null,
      path: targetRepo,
      baseRef: 'main',
      connectionId: 'connection-1',
      workspaceId: null,
      isInternal: false,
      createdAt: '2026-07-08T00:00:00.000Z',
      updatedAt: '2026-07-08T00:00:00.000Z',
    });
    mocks.teardownTaskMock.mockResolvedValue({ success: true });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('migrates a worktree task branch across ssh transports via a bundle', async () => {
    setupDb([[baseTaskRow], [], [{ ...baseTaskRow, projectId: 'target-project' }]]);

    const result = await moveTaskToProject('task-1', 'target-project');

    expect(result.success).toBe(true);
    expect(mocks.teardownTaskMock).toHaveBeenCalledWith('task-1', 'terminate');
    await expect(
      git(sourceRepo, ['rev-parse', '--verify', 'refs/heads/task/ssh-support'])
    ).rejects.toThrow();
    const migratedContent = await git(targetRepo, [
      'show',
      'refs/heads/task/ssh-support:feature.txt',
    ]);
    expect(migratedContent).toBe('migrated over ssh-like transport\n');
  });
});
