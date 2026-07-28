import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LocalProject } from '@shared/projects';

const mocks = vi.hoisted(() => ({
  getProjectById: vi.fn(),
  getRuntimeConfig: vi.fn(),
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

  beforeEach(async () => {
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
    vi.clearAllMocks();
  });

  it('returns missing project candidates and creates an edited Claude instruction file', async () => {
    const { getEditableRuntimeInstructionFiles, saveEditableRuntimeInstructionFile } = await import(
      './editable-instruction-files'
    );
    const request = { runtimeId: 'claude' as const, projectId: 'project-1' };

    const before = await getEditableRuntimeInstructionFiles(request);
    const projectFile = before.find((file) => file.kind === 'project-claude');
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
  });

  it('reads existing Codex project instructions and rejects paths outside the layer', async () => {
    const { getEditableRuntimeInstructionFiles, saveEditableRuntimeInstructionFile } = await import(
      './editable-instruction-files'
    );
    await writeFile(path.join(projectPath, 'AGENTS.md'), 'Existing rules', 'utf8');
    const request = { runtimeId: 'codex' as const, projectId: 'project-1' };

    const files = await getEditableRuntimeInstructionFiles(request);
    expect(files.find((file) => file.kind === 'project-agents')).toMatchObject({
      scope: 'project',
      exists: true,
      content: 'Existing rules',
    });
    expect(files.find((file) => file.kind === 'project-codex-agents')).toMatchObject({
      path: path.join(projectPath, '.codex', 'AGENTS.md'),
      exists: false,
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

    expect(files.find((file) => file.kind === 'global-codex-agents')).toMatchObject({
      path: path.join(codexHome, 'AGENTS.md'),
      scope: 'user',
      exists: false,
    });
  });
});
