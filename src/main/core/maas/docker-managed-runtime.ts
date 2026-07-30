import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { log } from '@main/lib/logger';

const execFileAsync = promisify(execFile);
const DOCKER_STATUS_TIMEOUT_MS = 5_000;

export type DockerCommandResult = {
  stdout: string;
  stderr: string;
};

export type DockerCommandRunner = (
  args: string[],
  options: { timeout: number; env?: NodeJS.ProcessEnv }
) => Promise<DockerCommandResult>;

type DockerDesktopOpener = () => Promise<void>;

export type DockerAvailability = {
  installed: boolean;
  running: boolean;
  version: string | null;
};

function dockerCommandCandidates(platform: NodeJS.Platform): string[] {
  const candidates = new Set<string>();
  if (process.env.DOCKER_BIN) candidates.add(process.env.DOCKER_BIN);
  candidates.add('docker');

  if (platform === 'darwin') {
    candidates.add('/Applications/Docker.app/Contents/Resources/bin/docker');
    candidates.add('/opt/homebrew/bin/docker');
    candidates.add('/usr/local/bin/docker');
  } else if (platform === 'win32') {
    const programFiles = process.env.ProgramFiles;
    if (programFiles) {
      candidates.add(join(programFiles, 'Docker', 'Docker', 'resources', 'bin', 'docker.exe'));
    }
  } else {
    candidates.add('/usr/bin/docker');
    candidates.add('/usr/local/bin/docker');
  }

  return [...candidates];
}

export function isCommandMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException)?.code === 'ENOENT';
}

export function createDockerCommandRunner(platform: NodeJS.Platform): DockerCommandRunner {
  let resolvedCommand: string | null = null;

  return async (args, options) => {
    const candidates = resolvedCommand ? [resolvedCommand] : dockerCommandCandidates(platform);
    let lastError: unknown;

    for (const command of candidates) {
      try {
        const result = await execFileAsync(command, args, {
          encoding: 'utf8',
          timeout: options.timeout,
          maxBuffer: 16 * 1024 * 1024,
          env: options.env ?? process.env,
        });
        resolvedCommand = command;
        return {
          stdout: String(result.stdout),
          stderr: String(result.stderr),
        };
      } catch (error) {
        lastError = error;
        if (!isCommandMissing(error)) throw error;
      }
    }

    throw lastError ?? Object.assign(new Error('Docker executable not found.'), { code: 'ENOENT' });
  };
}

function isLaunchServicesTransitionError(error: unknown): boolean {
  const commandError = error as NodeJS.ErrnoException & {
    stderr?: string | Buffer;
    stdout?: string | Buffer;
  };
  const output = [
    error instanceof Error ? error.message : '',
    String(commandError.stderr ?? ''),
    String(commandError.stdout ?? ''),
  ].join('\n');

  return /(?:^|\D)-600(?:\D|$)/.test(output);
}

export async function launchDockerDesktop(
  platform: NodeJS.Platform,
  runDocker: DockerCommandRunner,
  openDockerDesktop: DockerDesktopOpener = async () => {
    await execFileAsync('/usr/bin/open', ['-a', 'Docker'], {
      encoding: 'utf8',
      timeout: DOCKER_STATUS_TIMEOUT_MS,
    });
  }
): Promise<void> {
  if (platform === 'darwin') {
    try {
      await runDocker(['desktop', 'start', '--detach'], {
        timeout: DOCKER_STATUS_TIMEOUT_MS,
      });
      return;
    } catch (error) {
      log.warn('Docker Desktop CLI start failed; falling back to Launch Services:', error);
    }

    try {
      await openDockerDesktop();
    } catch (error) {
      if (!isLaunchServicesTransitionError(error)) throw error;

      // Launch Services can report -600 while Docker's backend is already
      // transitioning into a running state. The managed-service status poll is
      // the source of truth, so keep the request in its "starting" state.
      log.warn('Docker Desktop is already transitioning after the launch request:', error);
    }
    return;
  }

  throw new Error('Open Docker Desktop, then retry detection.');
}

export async function detectDocker(
  runDocker: DockerCommandRunner,
  timeout = DOCKER_STATUS_TIMEOUT_MS
): Promise<DockerAvailability> {
  let version: string | null = null;
  try {
    const result = await runDocker(['--version'], { timeout });
    version = result.stdout.trim() || null;
  } catch {
    return { installed: false, running: false, version: null };
  }

  try {
    await runDocker(['info', '--format', '{{.ServerVersion}}'], { timeout });
    return { installed: true, running: true, version };
  } catch {
    return { installed: true, running: false, version };
  }
}

export function managedRuntimeErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  return fallback;
}

export function managedRuntimeDelay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
