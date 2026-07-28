import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getCodexInstructionFiles, getInstructionFiles } from './instruction-files';

describe('runtime instruction file discovery', () => {
  let fixturePath: string;
  let previousClaudeConfigDir: string | undefined;
  let previousCodexHome: string | undefined;

  beforeEach(async () => {
    fixturePath = await mkdtemp(path.join(tmpdir(), 'yoda-runtime-instructions-'));
    previousClaudeConfigDir = process.env.CLAUDE_CONFIG_DIR;
    previousCodexHome = process.env.CODEX_HOME;
  });

  afterEach(async () => {
    if (previousClaudeConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = previousClaudeConfigDir;
    if (previousCodexHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = previousCodexHome;
    await rm(fixturePath, { recursive: true, force: true });
  });

  it('discovers the standard Claude user and project instruction files', async () => {
    const stateDirectory = path.join(fixturePath, 'claude-home');
    const projectPath = path.join(fixturePath, 'project');
    await mkdir(path.join(projectPath, '.claude'), { recursive: true });
    await mkdir(stateDirectory, { recursive: true });
    await Promise.all([
      writeFile(path.join(stateDirectory, 'CLAUDE.md'), 'User'),
      writeFile(path.join(projectPath, 'CLAUDE.md'), 'Project root'),
      writeFile(path.join(projectPath, '.claude', 'CLAUDE.md'), 'Project dotdir'),
      writeFile(path.join(projectPath, 'CLAUDE.local.md'), 'Project local'),
      writeFile(path.join(projectPath, 'AGENTS.md'), 'Not read by Claude'),
    ]);
    process.env.CLAUDE_CONFIG_DIR = stateDirectory;

    const files = await getInstructionFiles(projectPath);

    expect(files.map((file) => file.path)).toEqual([
      path.join(stateDirectory, 'CLAUDE.md'),
      path.join(projectPath, 'CLAUDE.md'),
      path.join(projectPath, '.claude', 'CLAUDE.md'),
      path.join(projectPath, 'CLAUDE.local.md'),
    ]);
  });

  it('discovers Codex override and AGENTS files from CODEX_HOME and the project root', async () => {
    const stateDirectory = path.join(fixturePath, 'codex-home');
    const projectPath = path.join(fixturePath, 'project');
    await mkdir(path.join(projectPath, '.codex'), { recursive: true });
    await mkdir(stateDirectory, { recursive: true });
    await Promise.all([
      writeFile(path.join(stateDirectory, 'AGENTS.override.md'), 'User override'),
      writeFile(path.join(stateDirectory, 'AGENTS.md'), 'User'),
      writeFile(path.join(projectPath, 'AGENTS.override.md'), 'Project override'),
      writeFile(path.join(projectPath, 'AGENTS.md'), 'Project'),
      writeFile(path.join(projectPath, '.codex', 'AGENTS.md'), 'Legacy wrong path'),
    ]);
    process.env.CODEX_HOME = stateDirectory;

    const files = await getCodexInstructionFiles(projectPath);

    expect(files.map((file) => file.path)).toEqual([
      path.join(stateDirectory, 'AGENTS.override.md'),
      path.join(stateDirectory, 'AGENTS.md'),
      path.join(projectPath, 'AGENTS.override.md'),
      path.join(projectPath, 'AGENTS.md'),
    ]);
  });
});
