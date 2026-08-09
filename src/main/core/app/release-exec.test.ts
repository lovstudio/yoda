import { beforeEach, describe, expect, it, vi } from 'vitest';

const execSyncMock = vi.hoisted(() => vi.fn());

vi.mock('node:child_process', () => ({
  execSync: execSyncMock,
}));

const { exec, execOrNull } = await import('@root/scripts/release/lib/exec');

describe('release command execution', () => {
  beforeEach(() => {
    execSyncMock.mockReset();
  });

  it('keeps the successful trimmed-output contract', () => {
    execSyncMock.mockReturnValue('  built successfully\n');

    expect(exec('build-release')).toBe('built successfully');
  });

  it('reports both captured output streams when a command fails', () => {
    execSyncMock.mockImplementation(() => {
      throw Object.assign(new Error('child process failed'), {
        status: 1,
        stdout: 'electron-builder: packaging linux\nfatal: missing artifact\n',
        stderr: 'node: deprecation warning\n',
      });
    });

    expect(() => exec('pnpm exec electron-builder --linux')).toThrowError(
      [
        'Command failed (exit 1): pnpm exec electron-builder --linux',
        'stdout:',
        'electron-builder: packaging linux\nfatal: missing artifact',
        'stderr:',
        'node: deprecation warning',
      ].join('\n')
    );
  });

  it('supports Buffer output without serializing the supplied environment', () => {
    execSyncMock.mockImplementation(() => {
      throw Object.assign(new Error('child process failed'), {
        status: null,
        stdout: Buffer.from('buffered stdout'),
        stderr: Buffer.from(''),
      });
    });

    const run = () => exec('release-tool', { env: { RELEASE_TOKEN: 'do-not-print-me' } });

    expect(run).toThrowError('Command failed (exit ?): release-tool\nstdout:\nbuffered stdout');
    expect(run).not.toThrowError(/do-not-print-me/);
  });

  it('preserves the null-on-failure helper contract', () => {
    execSyncMock.mockImplementation(() => {
      throw Object.assign(new Error('child process failed'), { status: 2 });
    });

    expect(execOrNull('optional-command')).toBeNull();
  });
});
