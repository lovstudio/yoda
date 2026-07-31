import path from 'node:path';
import { parse as parseToml } from 'smol-toml';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IExecutionContext } from '@main/core/execution-context/types';
import {
  FileSystemError,
  FileSystemErrorCodes,
  type FileSystemProvider,
} from '@main/core/fs/types';
import { CodexTrustService } from './codex-trust-service';

const mockReadFile = vi.hoisted(() => vi.fn());
const mockMkdir = vi.hoisted(() => vi.fn());
const mockStat = vi.hoisted(() => vi.fn());
const mockWriteFile = vi.hoisted(() => vi.fn());
const mockRename = vi.hoisted(() => vi.fn());
const mockRm = vi.hoisted(() => vi.fn());
const mockWarn = vi.hoisted(() => vi.fn());

vi.mock('node:fs', () => ({
  promises: {
    readFile: mockReadFile,
    mkdir: mockMkdir,
    stat: mockStat,
    writeFile: mockWriteFile,
    rename: mockRename,
    rm: mockRm,
  },
}));

vi.mock('@main/core/settings/settings-service', () => ({
  appSettingsService: { get: vi.fn() },
}));

vi.mock('@main/lib/logger', () => ({
  log: {
    warn: mockWarn,
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

function notFound(pathName: string): FileSystemError {
  return new FileSystemError(
    `File not found: ${pathName}`,
    FileSystemErrorCodes.NOT_FOUND,
    pathName
  );
}

function makeService(overrides: { autoTrustWorktrees?: boolean } = {}): CodexTrustService {
  return new CodexTrustService({
    getTaskSettings: () =>
      Promise.resolve({ autoTrustWorktrees: overrides.autoTrustWorktrees ?? true }),
  });
}

function makeRemoteFs(
  overrides: Partial<Pick<FileSystemProvider, 'realPath' | 'read' | 'write'>> = {}
): Pick<FileSystemProvider, 'realPath' | 'read' | 'write'> {
  return {
    realPath: vi.fn(async (value: string) => value),
    read: vi.fn().mockRejectedValue(notFound('/home/remote-user/.codex/config.toml')),
    write: vi.fn().mockResolvedValue({ success: true, bytesWritten: 0 }),
    ...overrides,
  };
}

describe('CodexTrustService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReadFile.mockRejectedValue(Object.assign(new Error('not found'), { code: 'ENOENT' }));
    mockMkdir.mockResolvedValue(undefined);
    mockStat.mockRejectedValue(Object.assign(new Error('not found'), { code: 'ENOENT' }));
    mockWriteFile.mockResolvedValue(undefined);
    mockRename.mockResolvedValue(undefined);
    mockRm.mockResolvedValue(undefined);
  });

  it('writes an exact trusted project entry to the active Codex home', async () => {
    const service = makeService();
    const projectPath = '/workspace/项目';

    await service.maybeAutoTrustLocal({
      runtimeId: 'codex',
      cwd: projectPath,
      codexHome: '/state/codex-account',
    });

    expect(mockMkdir).toHaveBeenCalledWith('/state/codex-account', { recursive: true });
    expect(mockRename).toHaveBeenCalledTimes(1);
    expect(mockRename.mock.calls[0][1]).toBe('/state/codex-account/config.toml');
    expect(mockWriteFile.mock.calls[0][2]).toEqual({ encoding: 'utf8', mode: 0o600 });

    const written = String(mockWriteFile.mock.calls[0][1]);
    const parsed = parseToml(written) as {
      projects: Record<string, { trust_level: string }>;
    };
    expect(parsed.projects[path.resolve(projectPath)].trust_level).toBe('trusted');
  });

  it('preserves unrelated TOML and comments while updating an existing project table', async () => {
    const service = makeService();
    const projectPath = '/workspace/project';
    mockReadFile.mockResolvedValue(
      [
        '# keep this comment',
        'model = "gpt-5.6-sol"',
        '',
        `[projects.${JSON.stringify(projectPath)}]`,
        'trust_level = "untrusted" # keep this too',
        'custom = "value"',
        '',
      ].join('\n')
    );
    mockStat.mockResolvedValue({ mode: 0o100640 });

    await service.maybeAutoTrustLocal({
      runtimeId: 'codex',
      cwd: projectPath,
      codexHome: '/state/codex',
    });

    const written = String(mockWriteFile.mock.calls[0][1]);
    expect(written).toContain('# keep this comment');
    expect(written).toContain('model = "gpt-5.6-sol"');
    expect(written).toContain('trust_level = "trusted" # keep this too');
    expect(written).toContain('custom = "value"');
    expect(mockWriteFile.mock.calls[0][2]).toEqual({ encoding: 'utf8', mode: 0o640 });
  });

  it('is idempotent when the project is already trusted', async () => {
    const service = makeService();
    const projectPath = '/workspace/project';
    mockReadFile.mockResolvedValue(
      `[projects.${JSON.stringify(projectPath)}]\ntrust_level = "trusted"\n`
    );

    await service.maybeAutoTrustLocal({
      runtimeId: 'codex',
      cwd: projectPath,
      codexHome: '/state/codex',
    });

    expect(mockWriteFile).not.toHaveBeenCalled();
    expect(mockRename).not.toHaveBeenCalled();
  });

  it('skips other runtimes and respects the setting', async () => {
    await makeService().maybeAutoTrustLocal({
      runtimeId: 'claude',
      cwd: '/workspace/project',
      codexHome: '/state/codex',
    });
    await makeService({ autoTrustWorktrees: false }).maybeAutoTrustLocal({
      runtimeId: 'codex',
      cwd: '/workspace/project',
      codexHome: '/state/codex',
    });

    expect(mockReadFile).not.toHaveBeenCalled();
    expect(mockWriteFile).not.toHaveBeenCalled();
  });

  it('leaves a corrupt Codex config untouched', async () => {
    const service = makeService();
    mockReadFile.mockResolvedValue('[invalid');

    await service.maybeAutoTrustLocal({
      runtimeId: 'codex',
      cwd: '/workspace/project',
      codexHome: '/state/codex',
    });

    expect(mockWriteFile).not.toHaveBeenCalled();
    expect(mockWarn).toHaveBeenCalledWith(
      'CodexTrustService: refusing to overwrite corrupt Codex config',
      expect.objectContaining({ error: expect.any(String) })
    );
  });

  it('writes and atomically renames the remote Codex config', async () => {
    const service = makeService();
    const remoteFs = makeRemoteFs({
      realPath: vi.fn().mockResolvedValue('/remote/workspace'),
    });
    const ctx: IExecutionContext = {
      root: undefined,
      supportsLocalSpawn: false,
      exec: vi.fn().mockResolvedValue({ stdout: '', stderr: '' }),
      execStreaming: vi.fn(),
      dispose: vi.fn(),
    };

    await service.maybeAutoTrustSsh({
      runtimeId: 'codex',
      cwd: '/remote/workspace',
      codexHome: '/state/remote-codex',
      ctx,
      remoteFs,
    });

    expect(ctx.exec).toHaveBeenCalledWith('mkdir', ['-p', '/state/remote-codex']);
    expect(remoteFs.read).toHaveBeenCalledWith(
      '/state/remote-codex/config.toml',
      expect.any(Number)
    );
    expect(remoteFs.write).toHaveBeenCalledTimes(1);
    const [temporaryPath, content] = vi.mocked(remoteFs.write).mock.calls[0];
    expect(temporaryPath).toContain('/state/remote-codex/config.toml.');
    expect(ctx.exec).toHaveBeenCalledWith('chmod', ['600', temporaryPath]);
    expect(ctx.exec).toHaveBeenCalledWith('mv', [temporaryPath, '/state/remote-codex/config.toml']);
    const parsed = parseToml(String(content)) as {
      projects: Record<string, { trust_level: string }>;
    };
    expect(parsed.projects['/remote/workspace'].trust_level).toBe('trusted');
  });
});
