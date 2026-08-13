import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { chmod, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { APP_ID, PRODUCT_NAME } from '@shared/app-identity';

export const LEGACY_CODEX_MAAS_API_KEY_ENV = 'YODA_MAAS_API_KEY';

const MANAGED_SCRIPT_MARKER = '# Managed by Yoda Codex Client sync';
const KEYCHAIN_SERVICE = `${APP_ID}.codex-maas-environment`;
const LAUNCH_AGENT_LABEL = `${APP_ID}.codex-maas-environment`;

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

type SecretCommandResult = ExecFileResult & {
  exitCode: number;
};

type ExecFileRunner = (file: string, args: string[]) => Promise<ExecFileResult>;
type SecretCommandRunner = (
  file: string,
  args: string[],
  input?: string
) => Promise<SecretCommandResult>;

type PersistenceOptions = {
  homeDirectory?: string;
  userId?: number;
  runSecretCommand?: SecretCommandRunner;
};

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

const defaultSecretCommandRunner: SecretCommandRunner = (file, args, input) =>
  new Promise((resolve, reject) => {
    const child = spawn(file, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.once('error', reject);
    child.once('close', (exitCode) => {
      resolve({
        exitCode: exitCode ?? 1,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
      });
    });
    child.stdin.end(input);
  });

export type CodexMaasEnvironmentPublisher = {
  read(name: string): Promise<EnvironmentVariableSnapshot>;
  publish(name: string, value: string): Promise<void>;
  restore(name: string, snapshot: EnvironmentVariableSnapshot): Promise<void>;
  readManaged(name: string): Promise<EnvironmentVariableSnapshot>;
  isManaged(name: string): Promise<boolean>;
  publishManaged(name: string, value: string, loginItemEnabled?: boolean): Promise<void>;
  clearManaged(name: string, snapshot: EnvironmentVariableSnapshot): Promise<void>;
};

/**
 * Publishes the Codex MaaS credential to the current user's GUI login session.
 *
 * Finder/Dock apps inherit their environment from launchd rather than the
 * login shell. External Client sync therefore stores a second, explicitly
 * consented copy in macOS Keychain and installs a LaunchAgent that republishes
 * it after login. The generated script and plist never contain the key.
 */
export class CodexMaasUserEnvironment implements CodexMaasEnvironmentPublisher {
  private readonly homeDirectory: string;
  private readonly userId: number;
  private readonly runSecretCommand: SecretCommandRunner;

  constructor(
    private readonly platform: NodeJS.Platform = process.platform,
    private readonly processEnvironment: NodeJS.ProcessEnv = process.env,
    private readonly runExecFile: ExecFileRunner = defaultExecFileRunner,
    options: PersistenceOptions = {}
  ) {
    this.homeDirectory = options.homeDirectory ?? homedir();
    this.userId = options.userId ?? process.getuid?.() ?? 0;
    this.runSecretCommand = options.runSecretCommand ?? defaultSecretCommandRunner;
  }

  async read(name: string): Promise<EnvironmentVariableSnapshot> {
    if (this.platform === 'darwin') {
      const result = await this.runLaunchctl(['getenv', name], 'read');
      const value = result.stdout.trim() || this.processEnvironment[name]?.trim() || '';
      return value ? { exists: true, value } : { exists: false };
    }

    const value = this.processEnvironment[name];
    return value ? { exists: true, value } : { exists: false };
  }

  async publish(name: string, value: string): Promise<void> {
    if (this.platform === 'darwin') {
      await this.runLaunchctl(['setenv', name, value], 'publish');
    }
    this.processEnvironment[name] = value;
  }

  async restore(name: string, snapshot: EnvironmentVariableSnapshot): Promise<void> {
    if (snapshot.exists) {
      await this.publish(name, snapshot.value);
      return;
    }

    if (this.platform === 'darwin') {
      await this.runLaunchctl(['unsetenv', name], 'clear');
    }
    delete this.processEnvironment[name];
  }

  async readManaged(name: string): Promise<EnvironmentVariableSnapshot> {
    if (this.platform !== 'darwin') return { exists: false };
    const result = await this.runSecurity([
      'find-generic-password',
      '-w',
      '-s',
      KEYCHAIN_SERVICE,
      '-a',
      name,
    ]);
    if (result.exitCode === 44) return { exists: false };
    if (result.exitCode !== 0) {
      throw new Error('Failed to read the Yoda-managed Codex credential from macOS Keychain.');
    }
    const value = result.stdout.replace(/\r?\n$/, '');
    return value ? { exists: true, value } : { exists: false };
  }

  async isManaged(name: string): Promise<boolean> {
    if (this.platform !== 'darwin') return false;
    const credential = await this.readManaged(name);
    if (!credential.exists) return false;
    const paths = this.resolvePersistencePaths();
    try {
      const [script, plist] = await Promise.all([
        readFile(paths.scriptPath, 'utf8'),
        readFile(paths.plistPath, 'utf8'),
      ]);
      return (
        script.includes(MANAGED_SCRIPT_MARKER) &&
        script.includes(`ENV_NAME='${name}'`) &&
        plist.includes(`<string>${LAUNCH_AGENT_LABEL}</string>`)
      );
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') return false;
      throw error;
    }
  }

  async publishManaged(name: string, value: string, loginItemEnabled = true): Promise<void> {
    if (this.platform !== 'darwin') {
      await this.publish(name, value);
      return;
    }
    validateEnvironmentName(name);
    const paths = this.resolvePersistencePaths();
    if (!loginItemEnabled) {
      await this.removePersistence(name, paths);
      await this.publish(name, value);
      return;
    }
    await rm(paths.legacyScriptPath, { force: true });
    await this.storeInKeychain(name, value);
    const [, plistChanged] = await Promise.all([
      writeManagedFileIfChanged(paths.scriptPath, buildLaunchAgentScript(name), 0o700),
      writeManagedFileIfChanged(paths.plistPath, buildLaunchAgentPlist(paths.scriptPath), 0o600),
    ]);
    if (plistChanged || !(await this.isLaunchAgentLoaded())) {
      await this.reloadLaunchAgent(paths.plistPath);
    }
    await this.publish(name, value);
  }

  async clearManaged(name: string, snapshot: EnvironmentVariableSnapshot): Promise<void> {
    if (this.platform !== 'darwin') {
      await this.restore(name, snapshot);
      return;
    }
    validateEnvironmentName(name);
    const paths = this.resolvePersistencePaths();
    await this.removePersistence(name, paths);
    await this.restore(name, snapshot);
  }

  private async removePersistence(
    name: string,
    paths: { scriptPath: string; legacyScriptPath: string; plistPath: string }
  ): Promise<void> {
    await this.runLaunchctl(
      ['bootout', `gui/${this.userId}`, paths.plistPath],
      'unload the Codex credential login item',
      true
    );
    await Promise.all([
      rm(paths.scriptPath, { force: true }),
      rm(paths.legacyScriptPath, { force: true }),
      rm(paths.plistPath, { force: true }),
    ]);
    const result = await this.runSecurity([
      'delete-generic-password',
      '-s',
      KEYCHAIN_SERVICE,
      '-a',
      name,
    ]);
    if (result.exitCode !== 0 && result.exitCode !== 44) {
      throw new Error('Failed to delete the Yoda-managed Codex credential from macOS Keychain.');
    }
  }

  private resolvePersistencePaths(): {
    scriptPath: string;
    legacyScriptPath: string;
    plistPath: string;
  } {
    return {
      scriptPath: join(
        this.homeDirectory,
        'Library',
        'Application Support',
        PRODUCT_NAME,
        'Yoda Model Access'
      ),
      legacyScriptPath: join(
        this.homeDirectory,
        'Library',
        'Application Support',
        PRODUCT_NAME,
        'codex-maas-environment.sh'
      ),
      plistPath: join(this.homeDirectory, 'Library', 'LaunchAgents', `${LAUNCH_AGENT_LABEL}.plist`),
    };
  }

  private async storeInKeychain(name: string, value: string): Promise<void> {
    const result = await this.runSecurity(
      [
        'add-generic-password',
        '-U',
        '-a',
        name,
        '-s',
        KEYCHAIN_SERVICE,
        '-l',
        `${PRODUCT_NAME} Codex Client sync: ${name}`,
        '-j',
        'Managed by Yoda. Clear it from Settings > Model access before uninstalling Yoda.',
        '-w',
      ],
      `${value}\n`
    );
    if (result.exitCode !== 0) {
      throw new Error('Failed to store the Codex credential in macOS Keychain.');
    }
  }

  private async reloadLaunchAgent(plistPath: string): Promise<void> {
    await this.runLaunchctl(
      ['bootout', `gui/${this.userId}`, plistPath],
      'replace the Codex credential login item',
      true
    );
    await this.runLaunchctl(
      ['bootstrap', `gui/${this.userId}`, plistPath],
      'install the Codex credential login item'
    );
  }

  private async isLaunchAgentLoaded(): Promise<boolean> {
    try {
      await this.runExecFile('/bin/launchctl', ['list', LAUNCH_AGENT_LABEL]);
      return true;
    } catch {
      return false;
    }
  }

  private runSecurity(args: string[], input?: string): Promise<SecretCommandResult> {
    return this.runSecretCommand('/usr/bin/security', args, input).catch(() => {
      // Security command output can contain a credential. Never include it or
      // the caller-provided input in an exception.
      throw new Error('Failed to access macOS Keychain for Codex Client sync.');
    });
  }

  private async runLaunchctl(
    args: string[],
    operation: string,
    ignoreFailure = false
  ): Promise<ExecFileResult> {
    try {
      return await this.runExecFile('/bin/launchctl', args);
    } catch {
      if (ignoreFailure) return { stdout: '', stderr: '' };
      // Never surface the command arguments: `setenv` contains the MaaS secret.
      throw new Error(
        `Failed to ${operation} the Codex MaaS environment variable in the macOS user session.`
      );
    }
  }
}

function buildLaunchAgentScript(name: string): string {
  return [
    '#!/bin/sh',
    MANAGED_SCRIPT_MARKER,
    `ENV_NAME='${name}'`,
    `KEYCHAIN_SERVICE='${KEYCHAIN_SERVICE}'`,
    'value=$(/usr/bin/security find-generic-password -w -s "$KEYCHAIN_SERVICE" -a "$ENV_NAME" 2>/dev/null) || exit 0',
    '[ -n "$value" ] || exit 0',
    '/bin/launchctl setenv "$ENV_NAME" "$value"',
    'unset value',
    '',
  ].join('\n');
}

function buildLaunchAgentPlist(scriptPath: string): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    '<dict>',
    '  <key>Label</key>',
    `  <string>${escapeXml(LAUNCH_AGENT_LABEL)}</string>`,
    '  <key>ProgramArguments</key>',
    '  <array>',
    `    <string>${escapeXml(scriptPath)}</string>`,
    '  </array>',
    '  <key>AssociatedBundleIdentifiers</key>',
    '  <array>',
    `    <string>${escapeXml(APP_ID)}</string>`,
    '  </array>',
    '  <key>RunAtLoad</key>',
    '  <true/>',
    '  <key>ProcessType</key>',
    '  <string>Background</string>',
    '</dict>',
    '</plist>',
    '',
  ].join('\n');
}

async function writeManagedFileIfChanged(
  path: string,
  content: string,
  mode: number
): Promise<boolean> {
  try {
    const [existingContent, metadata] = await Promise.all([readFile(path, 'utf8'), stat(path)]);
    if (existingContent === content) {
      if ((metadata.mode & 0o777) !== mode) await chmod(path, mode);
      return false;
    }
  } catch (error) {
    if (!isNodeError(error) || error.code !== 'ENOENT') throw error;
  }

  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporaryPath = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, content, { encoding: 'utf8', flag: 'wx', mode });
    await rename(temporaryPath, path);
    await chmod(path, mode);
  } finally {
    await rm(temporaryPath, { force: true });
  }
  return true;
}

function validateEnvironmentName(name: string): void {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new Error('Invalid Codex MaaS environment variable name.');
  }
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error;
}

export const codexMaasUserEnvironment = new CodexMaasUserEnvironment();
