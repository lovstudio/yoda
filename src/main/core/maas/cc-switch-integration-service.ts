import { execFile } from 'node:child_process';
import { access, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { shell } from 'electron';
import {
  CC_SWITCH_APP_NAME,
  CC_SWITCH_HOMEBREW_CASK,
  CC_SWITCH_RELEASES_URL,
  type CcSwitchInstallMethod,
  type CcSwitchIntegrationActionResult,
  type CcSwitchIntegrationOperation,
  type CcSwitchIntegrationStatus,
} from '@shared/cc-switch-integration';
import { log } from '@main/lib/logger';
import { managedRuntimeErrorMessage } from './docker-managed-runtime';

const execFileAsync = promisify(execFile);

const VERSION_TIMEOUT_MS = 5_000;
const INSTALL_TIMEOUT_MS = 10 * 60 * 1_000;
const HOMEBREW_BINARIES = ['/opt/homebrew/bin/brew', '/usr/local/bin/brew'];

/** CC Switch keeps device-level preferences next to its SQLite store. */
const CONFIG_DIRECTORY = join(homedir(), '.cc-switch');
const SETTINGS_FILE = join(CONFIG_DIRECTORY, 'settings.json');

function installCandidates(): string[] {
  if (process.platform === 'darwin') {
    return [
      `/Applications/${CC_SWITCH_APP_NAME}.app`,
      join(homedir(), 'Applications', `${CC_SWITCH_APP_NAME}.app`),
    ];
  }
  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA;
    const programFiles = process.env.ProgramFiles;
    return [
      localAppData ? join(localAppData, 'Programs', 'cc-switch', 'cc-switch.exe') : null,
      programFiles ? join(programFiles, 'cc-switch', 'cc-switch.exe') : null,
    ].filter((candidate): candidate is string => candidate !== null);
  }
  return [
    '/usr/bin/cc-switch',
    '/usr/local/bin/cc-switch',
    '/opt/cc-switch/cc-switch',
    join(homedir(), '.local', 'bin', 'cc-switch'),
  ];
}

async function firstExistingPath(candidates: string[]): Promise<string | null> {
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Keep probing the remaining candidates.
    }
  }
  return null;
}

async function readInstalledVersion(appPath: string): Promise<string | null> {
  if (process.platform !== 'darwin') return null;
  try {
    const { stdout } = await execFileAsync(
      'defaults',
      ['read', join(appPath, 'Contents', 'Info'), 'CFBundleShortVersionString'],
      { timeout: VERSION_TIMEOUT_MS }
    );
    const version = stdout.trim();
    return version || null;
  } catch {
    return null;
  }
}

async function readLocalProxyEnabled(): Promise<boolean> {
  try {
    const raw = await readFile(SETTINGS_FILE, 'utf8');
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return false;
    return 'enableLocalProxy' in parsed && parsed.enableLocalProxy === true;
  } catch {
    return false;
  }
}

export class CcSwitchIntegrationService {
  private activeOperation: CcSwitchIntegrationOperation | null = null;
  private pendingOperation: Promise<CcSwitchIntegrationActionResult> | null = null;

  async getStatus(): Promise<CcSwitchIntegrationStatus> {
    const [appPath, configured, localProxyEnabled, homebrewPath] = await Promise.all([
      firstExistingPath(installCandidates()),
      firstExistingPath([CONFIG_DIRECTORY]).then((path) => path !== null),
      readLocalProxyEnabled(),
      this.findHomebrew(),
    ]);
    const installMethod: CcSwitchInstallMethod =
      process.platform === 'darwin' && homebrewPath !== null ? 'homebrew' : 'download';

    return {
      state: appPath === null ? 'not-installed' : 'installed',
      operation: this.activeOperation,
      installed: appPath !== null,
      appPath,
      installedVersion: appPath === null ? null : await readInstalledVersion(appPath),
      configured,
      localProxyEnabled,
      installMethod,
    };
  }

  /**
   * Installs through Homebrew when available; otherwise hands the download page
   * to the browser, because the other platforms ship installers Yoda cannot drive.
   */
  async install(): Promise<CcSwitchIntegrationActionResult> {
    if (this.pendingOperation) return this.pendingOperation;

    const run = async (): Promise<CcSwitchIntegrationActionResult> => {
      const status = await this.getStatus();
      if (status.installed) return { success: true, status };

      if (status.installMethod === 'download') {
        await shell.openExternal(CC_SWITCH_RELEASES_URL);
        return { success: true, status };
      }

      const homebrewPath = await this.findHomebrew();
      if (homebrewPath === null) {
        await shell.openExternal(CC_SWITCH_RELEASES_URL);
        return { success: true, status: await this.getStatus() };
      }

      this.activeOperation = 'installing';
      try {
        await execFileAsync(homebrewPath, ['install', '--cask', CC_SWITCH_HOMEBREW_CASK], {
          timeout: INSTALL_TIMEOUT_MS,
          env: { ...process.env, HOMEBREW_NO_AUTO_UPDATE: '1', HOMEBREW_NO_ENV_HINTS: '1' },
        });
        this.activeOperation = null;
        return { success: true, status: await this.getStatus() };
      } catch (error) {
        log.error('Failed to install CC Switch via Homebrew:', error);
        this.activeOperation = null;
        return {
          success: false,
          status: await this.getStatus(),
          error: managedRuntimeErrorMessage(error, 'CC Switch installation failed.'),
        };
      }
    };

    const operation = run().finally(() => {
      this.pendingOperation = null;
      this.activeOperation = null;
    });
    this.pendingOperation = operation;
    return operation;
  }

  async open(): Promise<CcSwitchIntegrationActionResult> {
    const status = await this.getStatus();
    if (status.appPath === null) {
      return { success: false, status, error: 'CC Switch is not installed.' };
    }

    const openError = await shell.openPath(status.appPath);
    if (openError) {
      log.error('Failed to open CC Switch:', openError);
      return { success: false, status, error: openError };
    }
    return { success: true, status };
  }

  private findHomebrew(): Promise<string | null> {
    if (process.platform !== 'darwin') return Promise.resolve(null);
    return firstExistingPath(HOMEBREW_BINARIES);
  }
}

export const ccSwitchIntegrationService = new CcSwitchIntegrationService();
