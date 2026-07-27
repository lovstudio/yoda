import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { moveProjectPath } from './moveProjectPath';

const mocks = vi.hoisted(() => ({
  closeProject: vi.fn(),
  openProject: vi.fn(),
  detectInfo: vi.fn(),
  select: vi.fn(),
  from: vi.fn(),
  selectWhere: vi.fn(),
  limit: vi.fn(),
  update: vi.fn(),
  set: vi.fn(),
  updateWhere: vi.fn(),
  returning: vi.fn(),
  syncAgentProjectPathArtifacts: vi.fn(),
}));

vi.mock('@main/core/git/impl/git-service', () => ({
  GitService: vi.fn(function MockGitService() {
    return {
      detectInfo: mocks.detectInfo,
      getBranches: vi.fn(),
      getDefaultBranch: vi.fn(),
    };
  }),
}));

vi.mock('@main/core/github/services/github-connection-service', () => ({
  githubConnectionService: { getToken: vi.fn().mockResolvedValue(null) },
}));

vi.mock('@main/core/projects/project-manager', () => ({
  projectManager: {
    closeProject: mocks.closeProject,
    openProject: mocks.openProject,
  },
}));

vi.mock('@main/core/pull-requests/pr-sync-engine', () => ({
  prSyncEngine: { deleteProjectData: vi.fn() },
}));

vi.mock('@main/core/ssh/ssh-connection-manager', () => ({
  sshConnectionManager: { connect: vi.fn() },
}));

vi.mock('@main/core/view-state/view-state-service', () => ({
  viewStateService: { del: vi.fn() },
}));

vi.mock('@main/db/client', () => ({
  db: {
    select: mocks.select,
    update: mocks.update,
    transaction: vi.fn(),
  },
  sqlite: {
    prepare: vi.fn(() => ({ run: vi.fn() })),
  },
}));

vi.mock('./sync-agent-project-path-artifacts', () => ({
  syncAgentProjectPathArtifacts: mocks.syncAgentProjectPathArtifacts,
}));

const temporaryRoots: string[] = [];

function makeProjectRow(projectPath: string) {
  return {
    id: 'project-1',
    name: 'old-project-name',
    alias: '重命名后的项目',
    path: projectPath,
    workspaceProvider: 'local',
    workspaceId: null,
    baseRef: 'main',
    sshConnectionId: null,
    archivedAt: null,
    isInternal: 0,
    createdAt: '2026-07-27T00:00:00.000Z',
    updatedAt: '2026-07-27T00:00:00.000Z',
  };
}

function makeRepository(): { root: string; source: string; target: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yoda-move-operation-'));
  temporaryRoots.push(root);
  const source = path.join(root, 'old-project');
  const target = path.join(root, 'new-parent', 'renamed-project');
  fs.mkdirSync(source, { recursive: true });
  execFileSync('git', ['-C', source, 'init', '-q']);
  fs.writeFileSync(path.join(source, 'README.md'), 'project contents');
  return { root, source, target };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.select.mockReturnValue({ from: mocks.from });
  mocks.from.mockReturnValue({ where: mocks.selectWhere });
  mocks.selectWhere.mockReturnValue({ limit: mocks.limit });
  mocks.update.mockReturnValue({ set: mocks.set });
  mocks.set.mockReturnValue({ where: mocks.updateWhere });
  mocks.updateWhere.mockReturnValue({ returning: mocks.returning });
  mocks.closeProject.mockResolvedValue({ success: true, data: undefined });
  mocks.openProject.mockResolvedValue({ success: true, data: undefined });
  mocks.syncAgentProjectPathArtifacts.mockResolvedValue(undefined);
});

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe('moveProjectPath', () => {
  it('moves a local repository into a missing path while preserving the latest alias', async () => {
    const { source, target } = makeRepository();
    const row = makeProjectRow(source);
    const updated = { ...row, path: target };
    mocks.limit.mockResolvedValueOnce([row]).mockResolvedValueOnce([]);
    mocks.detectInfo
      .mockResolvedValueOnce({ isGitRepo: true, rootPath: source, baseRef: 'main' })
      .mockResolvedValueOnce({ isGitRepo: true, rootPath: target, baseRef: 'main' });
    mocks.returning.mockResolvedValue([updated]);

    const result = await moveProjectPath('project-1', {
      name: '重命名后的项目',
      path: target,
    });

    expect(fs.existsSync(source)).toBe(false);
    expect(fs.readFileSync(path.join(target, 'README.md'), 'utf8')).toBe('project contents');
    expect(mocks.closeProject).toHaveBeenCalledWith('project-1', { mode: 'terminate' });
    expect(mocks.set).toHaveBeenCalledWith(
      expect.objectContaining({
        alias: '重命名后的项目',
        path: target,
        baseRef: 'main',
      })
    );
    expect(mocks.set.mock.calls[0]?.[0]).not.toHaveProperty('name');
    expect(mocks.syncAgentProjectPathArtifacts).toHaveBeenCalledWith(source, target);
    expect(result).toMatchObject({
      id: 'project-1',
      name: 'old-project-name',
      alias: '重命名后的项目',
      path: target,
    });
  });

  it('rolls the directory move back and reopens the project when persistence fails', async () => {
    const { source, target } = makeRepository();
    const row = makeProjectRow(source);
    mocks.limit.mockResolvedValueOnce([row]).mockResolvedValueOnce([]);
    mocks.detectInfo
      .mockResolvedValueOnce({ isGitRepo: true, rootPath: source, baseRef: 'main' })
      .mockResolvedValueOnce({ isGitRepo: true, rootPath: target, baseRef: 'main' });
    mocks.returning.mockRejectedValue(new Error('database write failed'));

    await expect(
      moveProjectPath('project-1', {
        name: '重命名后的项目',
        path: target,
      })
    ).rejects.toThrow('database write failed');

    expect(fs.existsSync(target)).toBe(false);
    expect(fs.readFileSync(path.join(source, 'README.md'), 'utf8')).toBe('project contents');
    expect(mocks.openProject).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'project-1', path: source })
    );
    expect(mocks.syncAgentProjectPathArtifacts).not.toHaveBeenCalled();
  });
});
