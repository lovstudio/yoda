import { describe, expect, it, vi } from 'vitest';
import { launchDockerDesktop, type DockerCommandRunner } from './docker-managed-runtime';

describe('launchDockerDesktop', () => {
  it('keeps waiting for Docker readiness when Launch Services reports transition error -600', async () => {
    const runDocker: DockerCommandRunner = vi.fn(async () => {
      throw new Error('Docker Desktop CLI startup timed out.');
    });
    const openDockerDesktop = vi.fn(async () => {
      throw Object.assign(new Error('Command failed: /usr/bin/open -a Docker'), {
        stderr:
          '_LSOpenURLsWithCompletionHandler() failed for the application /Applications/Docker.app with error -600.',
      });
    });

    await expect(
      launchDockerDesktop('darwin', runDocker, openDockerDesktop)
    ).resolves.toBeUndefined();
    expect(runDocker).toHaveBeenCalledWith(['desktop', 'start', '--detach'], {
      timeout: 5_000,
    });
    expect(openDockerDesktop).toHaveBeenCalledOnce();
  });

  it('still reports non-transitional Launch Services failures', async () => {
    const runDocker: DockerCommandRunner = vi.fn(async () => {
      throw new Error('Docker Desktop CLI is unavailable.');
    });
    const openError = new Error('Docker application is damaged.');
    const openDockerDesktop = vi.fn(async () => {
      throw openError;
    });

    await expect(launchDockerDesktop('darwin', runDocker, openDockerDesktop)).rejects.toBe(
      openError
    );
  });
});
