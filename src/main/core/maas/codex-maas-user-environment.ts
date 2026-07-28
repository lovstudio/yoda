import { promisify } from 'node:util';

export const CODEX_MAAS_API_KEY_ENV = 'YODA_MAAS_API_KEY';

export type EnvironmentVariableSnapshot =
  | { exists: false }
  | {
      exists: true;
      value: string;
    };

type ExecFileResult = {
  stdout: string;
  stderr: string;
};

type ExecFileRunner = (file: string, args: string[]) => Promise<ExecFileResult>;

const defaultExecFileRunner: ExecFileRunner = async (file, args) => {
  // Load lazily so modules that mock child_process for unrelated Codex spawns
  // do not need to provide execFile unless this publisher is actually invoked.
  const { execFile } = await import('node:child_process');
  const execFileAsync = promisify(execFile);
  const result = await execFileAsync(file, args, { encoding: 'utf8' });
  return {
    stdout: result.stdout,
    stderr: result.stderr,
  };
};

export type CodexMaasEnvironmentPublisher = {
  read(): Promise<EnvironmentVariableSnapshot>;
  publish(value: string): Promise<void>;
  restore(snapshot: EnvironmentVariableSnapshot): Promise<void>;
};

/**
 * Publishes the Codex MaaS credential to the current user's GUI login session.
 *
 * macOS apps launched from Finder or the Dock inherit their environment from
 * launchd rather than from the user's login shell, so exporting a variable in
 * zsh is insufficient. Other platforms keep the variable process-scoped until
 * an equivalent desktop-session publisher is implemented.
 */
export class CodexMaasUserEnvironment implements CodexMaasEnvironmentPublisher {
  constructor(
    private readonly platform: NodeJS.Platform = process.platform,
    private readonly processEnvironment: NodeJS.ProcessEnv = process.env,
    private readonly runExecFile: ExecFileRunner = defaultExecFileRunner
  ) {}

  async read(): Promise<EnvironmentVariableSnapshot> {
    if (this.platform === 'darwin') {
      const result = await this.runLaunchctl(['getenv', CODEX_MAAS_API_KEY_ENV], 'read');
      const value =
        result.stdout.trim() || this.processEnvironment[CODEX_MAAS_API_KEY_ENV]?.trim() || '';
      return value ? { exists: true, value } : { exists: false };
    }

    const value = this.processEnvironment[CODEX_MAAS_API_KEY_ENV];
    return value ? { exists: true, value } : { exists: false };
  }

  async publish(value: string): Promise<void> {
    if (this.platform === 'darwin') {
      await this.runLaunchctl(['setenv', CODEX_MAAS_API_KEY_ENV, value], 'publish');
    }
    this.processEnvironment[CODEX_MAAS_API_KEY_ENV] = value;
  }

  async restore(snapshot: EnvironmentVariableSnapshot): Promise<void> {
    if (snapshot.exists) {
      await this.publish(snapshot.value);
      return;
    }

    if (this.platform === 'darwin') {
      await this.runLaunchctl(['unsetenv', CODEX_MAAS_API_KEY_ENV], 'clear');
    }
    delete this.processEnvironment[CODEX_MAAS_API_KEY_ENV];
  }

  private async runLaunchctl(args: string[], operation: string): Promise<ExecFileResult> {
    try {
      return await this.runExecFile('/bin/launchctl', args);
    } catch {
      // Never surface the command arguments: `setenv` contains the MaaS secret.
      throw new Error(
        `Failed to ${operation} the Codex MaaS environment variable in the macOS user session.`
      );
    }
  }
}

export const codexMaasUserEnvironment = new CodexMaasUserEnvironment();
