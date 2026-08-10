import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LocalProject } from '@shared/projects';
import * as schema from '@main/db/schema';

const mocks = vi.hoisted(() => ({
  db: null as unknown,
  getProjectById: vi.fn(),
  getRuntimeConfig: vi.fn(),
}));

vi.mock('@main/db/client', () => ({
  get db() {
    return mocks.db;
  },
}));

vi.mock('@main/core/projects/operations/getProjects', () => ({
  getProjectById: mocks.getProjectById,
}));

vi.mock('@main/core/settings/runtime-settings-service', () => ({
  runtimeOverrideSettings: { getItem: mocks.getRuntimeConfig },
}));

vi.mock('@main/core/ssh/ssh-connection-manager', () => ({
  sshConnectionManager: { connect: vi.fn() },
}));

vi.mock('@main/core/ssh/utils', () => ({
  resolveRemoteHome: vi.fn(),
}));

describe('editable runtime instruction files', () => {
  let projectPath: string;
  let sqlite: Database.Database;

  beforeEach(async () => {
    sqlite = new Database(':memory:');
    sqlite.exec(`
      CREATE TABLE runtime_instruction_file_versions (
        id TEXT PRIMARY KEY NOT NULL,
        file_key TEXT NOT NULL,
        runtime_id TEXT NOT NULL,
        project_id TEXT,
        scope TEXT NOT NULL,
        kind TEXT NOT NULL,
        path TEXT NOT NULL,
        version INTEGER NOT NULL,
        content TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
      );
      CREATE UNIQUE INDEX idx_runtime_instruction_file_versions_file_key_version
        ON runtime_instruction_file_versions(file_key, version);
    `);
    mocks.db = drizzle(sqlite, { schema });
    projectPath = await mkdtemp(path.join(tmpdir(), 'yoda-prompt-files-'));
    mocks.getRuntimeConfig.mockResolvedValue(undefined);
    const project: LocalProject = {
      type: 'local',
      id: 'project-1',
      name: 'Project',
      alias: null,
      path: projectPath,
      baseRef: 'main',
      workspaceId: null,
      isInternal: false,
      createdAt: '2026-07-29T00:00:00.000Z',
      updatedAt: '2026-07-29T00:00:00.000Z',
    };
    mocks.getProjectById.mockResolvedValue(project);
  });

  afterEach(async () => {
    await rm(projectPath, { recursive: true, force: true });
    sqlite.close();
    mocks.db = null;
    vi.clearAllMocks();
  });

  it('returns missing project candidates and creates an edited Claude instruction file', async () => {
    const {
      getEditableRuntimeInstructionFiles,
      listRuntimeInstructionFileVersions,
      restoreRuntimeInstructionFileVersion,
      saveEditableRuntimeInstructionFile,
    } = await import('./editable-instruction-files');
    const request = { runtimeId: 'claude' as const, projectId: 'project-1' };

    const before = await getEditableRuntimeInstructionFiles(request);
    const projectFiles = before.filter((file) => file.scope === 'project');
    expect(projectFiles.map((file) => file.path)).toEqual([
      path.join(projectPath, 'CLAUDE.md'),
      path.join(projectPath, '.claude', 'CLAUDE.md'),
      path.join(projectPath, 'CLAUDE.local.md'),
    ]);
    const projectFile = projectFiles[0];
    expect(projectFile).toMatchObject({
      path: path.join(projectPath, 'CLAUDE.md'),
      scope: 'project',
      exists: false,
      content: '',
    });

    const saved = await saveEditableRuntimeInstructionFile({
      ...request,
      path: path.join(projectPath, 'CLAUDE.md'),
      content: '# Project instructions\n',
    });
    expect(saved).toMatchObject({
      kind: 'project-claude',
      scope: 'project',
      exists: true,
      content: '# Project instructions\n',
    });
    await expect(readFile(path.join(projectPath, 'CLAUDE.md'), 'utf8')).resolves.toBe(
      '# Project instructions\n'
    );

    await saveEditableRuntimeInstructionFile({
      ...request,
      path: path.join(projectPath, 'CLAUDE.md'),
      content: '# Updated project instructions\n',
    });
    await expect(
      listRuntimeInstructionFileVersions({
        ...request,
        path: path.join(projectPath, 'CLAUDE.md'),
      })
    ).resolves.toEqual([
      expect.objectContaining({ version: 2, content: '# Updated project instructions\n' }),
      expect.objectContaining({ version: 1, content: '# Project instructions\n' }),
    ]);

    await restoreRuntimeInstructionFileVersion({
      ...request,
      path: path.join(projectPath, 'CLAUDE.md'),
      version: 1,
    });
    await expect(readFile(path.join(projectPath, 'CLAUDE.md'), 'utf8')).resolves.toBe(
      '# Project instructions\n'
    );
  });

  it('reads existing Codex project instructions and rejects paths outside the layer', async () => {
    const { getEditableRuntimeInstructionFiles, saveEditableRuntimeInstructionFile } = await import(
      './editable-instruction-files'
    );
    await writeFile(path.join(projectPath, 'AGENTS.md'), 'Existing rules', 'utf8');
    const request = { runtimeId: 'codex' as const, projectId: 'project-1' };

    const files = await getEditableRuntimeInstructionFiles(request);
    const projectFiles = files.filter((file) => file.scope === 'project');
    expect(projectFiles.map((file) => file.path)).toEqual([
      path.join(projectPath, 'AGENTS.override.md'),
      path.join(projectPath, 'AGENTS.md'),
    ]);
    expect(
      projectFiles.find((file) => file.path === path.join(projectPath, 'AGENTS.md'))
    ).toMatchObject({
      scope: 'project',
      exists: true,
      content: 'Existing rules',
    });

    await expect(
      saveEditableRuntimeInstructionFile({
        ...request,
        path: path.join(projectPath, 'README.md'),
        content: 'Unexpected target',
      })
    ).rejects.toThrow('outside the selected prompt layer');
  });

  it('uses the Agent runtime state directory for the user-level instruction file', async () => {
    const { getEditableRuntimeInstructionFiles } = await import('./editable-instruction-files');
    const codexHome = path.join(projectPath, 'custom-codex-home');
    mocks.getRuntimeConfig.mockResolvedValue({ env: { CODEX_HOME: codexHome } });

    const files = await getEditableRuntimeInstructionFiles({
      runtimeId: 'codex',
      projectId: 'project-1',
    });

    expect(files.filter((file) => file.scope === 'user').map((file) => file.path)).toEqual([
      path.join(codexHome, 'AGENTS.override.md'),
      path.join(codexHome, 'AGENTS.md'),
    ]);
  });

  it('surfaces read errors instead of reporting an unreadable path as missing', async () => {
    const { getEditableRuntimeInstructionFiles } = await import('./editable-instruction-files');
    const codexHome = path.join(projectPath, 'custom-codex-home');
    await mkdir(path.join(codexHome, 'AGENTS.md'), { recursive: true });
    mocks.getRuntimeConfig.mockResolvedValue({ env: { CODEX_HOME: codexHome } });

    await expect(
      getEditableRuntimeInstructionFiles({
        runtimeId: 'codex',
        projectId: 'project-1',
      })
    ).rejects.toMatchObject({ code: 'EISDIR' });
  });
});
