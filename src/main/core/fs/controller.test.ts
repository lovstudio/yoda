import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { filesController } from './controller';

const mocks = vi.hoisted(() => ({
  connect: vi.fn(async () => ({ client: {} })),
  getProject: vi.fn(),
  getProjectById: vi.fn(),
  sshList: vi.fn(),
  sshRoots: [] as string[],
}));

vi.mock('@main/core/projects/operations/getProjects', () => ({
  getProjectById: mocks.getProjectById,
}));

vi.mock('@main/core/projects/project-manager', () => ({
  projectManager: { getProject: mocks.getProject },
}));

vi.mock('@main/core/ssh/ssh-connection-manager', () => ({
  sshConnectionManager: { connect: mocks.connect },
}));

vi.mock('@main/lib/events', () => ({
  events: { emit: vi.fn(), on: vi.fn() },
}));

vi.mock('../projects/utils', () => ({
  resolveWorkspace: vi.fn(),
}));

vi.mock('@main/core/fs/impl/ssh-fs', () => ({
  SshFileSystem: class {
    constructor(_proxy: unknown, root: string) {
      mocks.sshRoots.push(root);
    }

    list = mocks.sshList;
  },
}));

describe('filesController.listPathCompletions', () => {
  let tempRoot: string;

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'path-completion-'));
    mocks.connect.mockClear();
    mocks.getProject.mockReset();
    mocks.getProjectById.mockReset();
    mocks.sshList.mockReset();
    mocks.sshRoots.length = 0;
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it('lists paths above a local project and keeps them project-relative', async () => {
    const projectPath = path.join(tempRoot, 'project');
    fs.mkdirSync(projectPath);
    fs.mkdirSync(path.join(tempRoot, 'sibling'));
    mocks.getProjectById.mockResolvedValue({
      id: 'project-1',
      path: projectPath,
      type: 'local',
    });

    const result = await filesController.listPathCompletions('project-1', '..', {
      allowOutsideProject: true,
      includeHidden: false,
      pathKind: 'relative',
    });

    expect(result.success).toBe(true);
    if (!result.success) throw new Error('Expected local path completions');
    expect(result.data.entries.map((entry) => entry.path)).toEqual(['../project', '../sibling']);
  });

  it('keeps ordinary project completion requests inside the local project', async () => {
    const projectPath = path.join(tempRoot, 'project');
    fs.mkdirSync(projectPath);
    mocks.getProjectById.mockResolvedValue({
      id: 'project-1',
      path: projectPath,
      type: 'local',
    });

    const result = await filesController.listPathCompletions('project-1', '..', {
      includeHidden: false,
      pathKind: 'relative',
    });

    expect(result).toMatchObject({ success: false, error: { type: 'fs_error' } });
  });

  it('lists paths above an SSH project from the remote root and rebases them', async () => {
    mocks.getProjectById.mockResolvedValue({
      connectionId: 'connection-1',
      id: 'project-1',
      path: '/srv/project',
      type: 'ssh',
    });
    mocks.sshList.mockResolvedValue({
      durationMs: 1,
      entries: [
        { path: '/srv/project', type: 'dir' },
        { path: '/srv/sibling', type: 'dir' },
      ],
      total: 2,
      truncated: false,
    });

    const result = await filesController.listPathCompletions('project-1', '..', {
      allowOutsideProject: true,
      includeHidden: false,
      pathKind: 'relative',
    });

    expect(mocks.connect).toHaveBeenCalledWith('connection-1');
    expect(mocks.sshRoots).toEqual(['/']);
    expect(mocks.sshList).toHaveBeenCalledWith(
      '/srv',
      expect.objectContaining({ includeHidden: false, recursive: false })
    );
    expect(result.success).toBe(true);
    if (!result.success) throw new Error('Expected SSH path completions');
    expect(result.data.entries).toEqual([
      { path: '../project', type: 'dir' },
      { path: '../sibling', type: 'dir' },
    ]);
  });
});
