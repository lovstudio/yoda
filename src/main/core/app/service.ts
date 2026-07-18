import { exec } from 'node:child_process';
import { stat, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { eq } from 'drizzle-orm';
import { app, clipboard, dialog, shell } from 'electron';
import { isAiLabWindowTarget, type AiLabWindowTarget } from '@shared/ai-lab-window';
import type { AppResourceSnapshot } from '@shared/app-resource';
import { isComparisonWindowTarget, type ComparisonWindowTarget } from '@shared/comparison-window';
import {
  appPasteChannel,
  appRedoChannel,
  appUndoChannel,
  notificationFocusTaskChannel,
  taskWindowReturnedToTabChannel,
  type TaskWindowReturnPayload,
} from '@shared/events/appEvents';
import {
  getAppById,
  getResolvedLabel,
  OPEN_IN_APPS,
  type OpenInAppId,
  type OpenInRequest,
  type PlatformConfig,
  type PlatformKey,
} from '@shared/openInApps';
import { isTaskWindowTarget, type TaskWindowTarget } from '@shared/task-window';
import { setLeftSidebarMenuChecked } from '@main/app/menu';
import {
  registerTaskWindowDock,
  setTaskStripDropZone,
  unregisterTaskWindowDock,
  type TaskStripDropZone,
} from '@main/app/task-window-dock';
import { openTaskWindowFromPool } from '@main/app/task-window-pool';
import { createAiLabWindow, createComparisonWindow, getMainWindow } from '@main/app/window';
import { taskManager } from '@main/core/tasks/task-manager';
import { db } from '@main/db/client';
import { sshConnections } from '@main/db/schema';
import { events } from '@main/lib/events';
import type { IDisposable, IInitializable } from '@main/lib/lifecycle';
import { log } from '@main/lib/logger';
import { buildExternalToolEnv } from '@main/utils/childProcessEnv';
import {
  buildLocalOpenCommand,
  normalizeOpenFileLocation,
  type OpenFileLocation,
} from '@main/utils/localOpenIn';
import {
  buildRemoteEditorUrl,
  buildRemoteSshCommand,
  buildRemoteTerminalExecArgs,
} from '@main/utils/remoteOpenIn';
import {
  checkCommand,
  checkMacApp,
  checkMacAppByName,
  escapeAppleScriptString,
  execFileCommand,
  listInstalledFontsAll,
  resolveAppVersion,
} from './utils';
import {
  triggerVoiceInput,
  type TriggerVoiceInputArgs,
  type TriggerVoiceInputResult,
} from './voice-input';

const FONT_CACHE_TTL_MS = 5 * 60 * 1_000;

type RemoteTerminalLaunchAttempt = {
  file: string;
  args: string[];
};

export type SaveTextFileDialogArgs = {
  title?: string;
  defaultPath: string;
  content: string;
  filters?: Array<{ name: string; extensions: string[] }>;
};

class AppService implements IInitializable, IDisposable {
  private cachedAppVersion: string | null = null;
  private cachedAppVersionPromise: Promise<string> | null = null;
  private cachedInstalledFonts: { fonts: string[]; fetchedAt: number } | null = null;
  private _unsubscribes: Array<() => void> = [];

  initialize(): void {
    void this.getCachedAppVersion();

    this._unsubscribes = [
      events.on(appUndoChannel, () => {
        getMainWindow()?.webContents.undo();
      }),
      events.on(appRedoChannel, () => {
        getMainWindow()?.webContents.redo();
      }),
      events.on(appPasteChannel, () => {
        getMainWindow()?.webContents.paste();
      }),
    ];
  }

  dispose(): void {
    for (const unsub of this._unsubscribes) unsub();
    this._unsubscribes = [];
  }

  getCachedAppVersion(): Promise<string> {
    if (this.cachedAppVersion) return Promise.resolve(this.cachedAppVersion);
    if (!this.cachedAppVersionPromise) {
      this.cachedAppVersionPromise = resolveAppVersion().then((version) => {
        this.cachedAppVersion = version;
        return version;
      });
    }
    return this.cachedAppVersionPromise;
  }

  getResourceSnapshot(): AppResourceSnapshot {
    const processes = app
      .getAppMetrics()
      .map((metric) => ({
        pid: metric.pid,
        type: String(metric.type),
        cpuPercent: Math.round(metric.cpu.percentCPUUsage * 10) / 10,
        // Electron reports process working-set size in KiB.
        memoryBytes: metric.memory.workingSetSize * 1024,
      }))
      .sort((left, right) => right.memoryBytes - left.memoryBytes);

    return {
      sampledAt: new Date().toISOString(),
      cpuPercent:
        Math.round(processes.reduce((total, item) => total + item.cpuPercent, 0) * 10) / 10,
      memoryBytes: processes.reduce((total, item) => total + item.memoryBytes, 0),
      activeAgentSessions: taskManager.getActiveAgentSessionSummary().running,
      processes,
    };
  }

  async listInstalledFonts(
    refresh?: boolean
  ): Promise<{ fonts: string[]; cached: boolean; error?: string }> {
    const now = Date.now();
    if (
      !refresh &&
      this.cachedInstalledFonts &&
      now - this.cachedInstalledFonts.fetchedAt < FONT_CACHE_TTL_MS
    ) {
      return { fonts: this.cachedInstalledFonts.fonts, cached: true };
    }
    try {
      const fonts = await listInstalledFontsAll();
      this.cachedInstalledFonts = { fonts, fetchedAt: now };
      return { fonts, cached: false };
    } catch (error) {
      return {
        fonts: this.cachedInstalledFonts?.fonts ?? [],
        cached: Boolean(this.cachedInstalledFonts),
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async checkInstalledApps(): Promise<Record<string, boolean>> {
    const platform = process.platform as PlatformKey;
    const availability: Record<string, boolean> = {};

    for (const openInApp of Object.values(OPEN_IN_APPS)) {
      const platformConfig = openInApp.platforms[platform];
      if (!platformConfig && !openInApp.alwaysAvailable) {
        availability[openInApp.id] = false;
        continue;
      }
      if (openInApp.alwaysAvailable) {
        availability[openInApp.id] = true;
        continue;
      }
      try {
        let isAvailable = false;
        if (platformConfig?.bundleIds) {
          for (const bundleId of platformConfig.bundleIds) {
            if (await checkMacApp(bundleId)) {
              isAvailable = true;
              break;
            }
          }
        }
        if (!isAvailable && platformConfig?.appNames) {
          for (const appName of platformConfig.appNames) {
            if (await checkMacAppByName(appName)) {
              isAvailable = true;
              break;
            }
          }
        }
        if (!isAvailable && platformConfig?.checkCommands) {
          for (const cmd of platformConfig.checkCommands) {
            if (await checkCommand(cmd)) {
              isAvailable = true;
              break;
            }
          }
        }
        availability[openInApp.id] = isAvailable;
      } catch (error) {
        log.error(`Error checking installed app ${openInApp.id}:`, error);
        availability[openInApp.id] = false;
      }
    }

    return availability;
  }

  async openExternal(url: string): Promise<void> {
    if (!url || typeof url !== 'string') throw new Error('Invalid URL');
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      throw new Error('Invalid URL format');
    }
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      throw new Error(
        `Protocol "${parsedUrl.protocol}" is not allowed. Only http and https URLs are permitted.`
      );
    }
    await shell.openExternal(url);
  }

  clipboardWriteText(text: string): void {
    if (typeof text !== 'string') throw new Error('Invalid clipboard text');
    clipboard.writeText(text);
  }

  triggerVoiceInput(args?: TriggerVoiceInputArgs): Promise<TriggerVoiceInputResult> {
    return triggerVoiceInput(args);
  }

  openTaskWindow(target: TaskWindowTarget): void {
    if (!isTaskWindowTarget(target)) throw new Error('Invalid task window target');
    openTaskWindowFromPool(target);
  }

  openComparisonWindow(target: ComparisonWindowTarget): void {
    if (!isComparisonWindowTarget(target)) throw new Error('Invalid comparison window target');
    createComparisonWindow(target);
  }

  openAiLabWindow(target: AiLabWindowTarget): void {
    if (!isAiLabWindowTarget(target)) throw new Error('Invalid AI Lab window target');
    createAiLabWindow(target);
  }

  /** From a comparison pane: route the main window to one of the compared tasks. */
  focusTaskInMainWindow(target: { projectId: string; taskId: string }): void {
    if (!target.projectId || !target.taskId) throw new Error('Invalid focus task target');
    events.emit(notificationFocusTaskChannel, {
      projectId: target.projectId,
      taskId: target.taskId,
    });
  }

  notifyTaskWindowReturned(payload: TaskWindowReturnPayload): void {
    if (!Number.isInteger(payload.sourceWindowId) || payload.sourceWindowId <= 0) {
      throw new Error('Invalid task window source');
    }
    if (!isTaskWindowTarget(payload.target)) throw new Error('Invalid task window target');
    events.emit(taskWindowReturnedToTabChannel, payload);
  }

  registerTaskWindowDock(payload: TaskWindowReturnPayload): void {
    if (!Number.isInteger(payload.sourceWindowId) || payload.sourceWindowId <= 0) {
      throw new Error('Invalid task window source');
    }
    registerTaskWindowDock(payload.sourceWindowId, payload.target);
  }

  unregisterTaskWindowDock(sourceWindowId: number): void {
    unregisterTaskWindowDock(sourceWindowId);
  }

  setTaskStripDropZone(zone: TaskStripDropZone | null): void {
    setTaskStripDropZone(zone);
  }

  setLeftSidebarMenuChecked(checked: boolean): void {
    setLeftSidebarMenuChecked(checked);
  }

  async openIn(args: OpenInRequest): Promise<void> {
    const {
      path: target,
      app: appId,
      isRemote = false,
      sshConnectionId,
      reveal = false,
      line,
      column,
    } = args;

    if (!target || typeof target !== 'string' || !appId) {
      throw new Error('Invalid arguments');
    }
    const location = normalizeOpenFileLocation(line, column);

    if (reveal) {
      if (isRemote) throw new Error('Reveal is not available for remote paths.');
      shell.showItemInFolder(target);
      return;
    }

    const platform = process.platform as PlatformKey;
    const appConfig = getAppById(appId);
    if (!appConfig) throw new Error('Invalid app ID');

    const platformConfig = appConfig.platforms?.[platform];
    const label = getResolvedLabel(appConfig, platform);

    if (!platformConfig && !appConfig.alwaysAvailable) {
      throw new Error(`${label} is not available on this platform.`);
    }

    if (isRemote && sshConnectionId) {
      await this.openInRemote({
        appId,
        appConfig,
        label,
        target,
        platform,
        sshConnectionId,
      });
      return;
    }

    // The generic "Finder" opener means "open with the OS default" (a folder in
    // Finder, a file with its default app). Use Electron's shell.openPath — the
    // LaunchServices API directly — instead of shelling out to `open`, matching
    // the working reveal path above and surfacing any LS error as a real string.
    // NOTE: a polluted LaunchServices database (stale duplicate handler
    // registrations for a UTI) can still make resolution non-deterministic and
    // yield a `"(null)" has no permission to open …` error; that is a system
    // issue fixed by rebuilding the LS DB (`lsregister -kill -r -all`), not here.
    if (appId === 'finder') {
      const errorMessage = await shell.openPath(target);
      if (errorMessage) throw new Error(errorMessage);
      return;
    }

    await this.openInLocal({ label, target, platformConfig, location });
  }

  private async openInRemote(args: {
    appId: OpenInAppId;
    appConfig: ReturnType<typeof getAppById>;
    label: string;
    target: string;
    platform: PlatformKey;
    sshConnectionId: string;
  }): Promise<void> {
    const { appId, appConfig, label, target, platform, sshConnectionId } = args;

    const [connection] = await db
      .select()
      .from(sshConnections)
      .where(eq(sshConnections.id, sshConnectionId))
      .limit(1);

    if (!connection) throw new Error('SSH connection not found');

    const { host, username, port } = connection;

    if (appId === 'vscode' || appId === 'vscodium' || appId === 'cursor') {
      await shell.openExternal(buildRemoteEditorUrl(appId, host, username, target));
      return;
    }

    if ((appId === 'terminal' || appId === 'iterm2') && platform === 'darwin') {
      const sshCommand = buildRemoteSshCommand({ host, username, port, targetPath: target });
      const escapedCommand = escapeAppleScriptString(sshCommand);
      const appName = appId === 'terminal' ? 'Terminal' : 'iTerm';
      const script =
        appId === 'terminal'
          ? `tell application "${appName}" to do script "${escapedCommand}"`
          : `tell application "${appName}" to create window with default profile command "${escapedCommand}"`;
      await execFileCommand('osascript', [
        '-e',
        script,
        '-e',
        `tell application "${appName}" to activate`,
      ]);
      return;
    }

    if (appId === 'warp' && platform === 'darwin') {
      const sshCommand = buildRemoteSshCommand({ host, username, port, targetPath: target });
      await shell.openExternal(`warp://action/new_window?cmd=${encodeURIComponent(sshCommand)}`);
      return;
    }

    if (appId === 'ghostty') {
      const remoteExecArgs = buildRemoteTerminalExecArgs({
        host,
        username,
        port,
        targetPath: target,
      });
      const attempts =
        platform === 'darwin'
          ? [
              {
                file: 'open',
                args: ['-n', '-b', 'com.mitchellh.ghostty', '--args', '-e', ...remoteExecArgs],
              },
              { file: 'open', args: ['-na', 'Ghostty', '--args', '-e', ...remoteExecArgs] },
              { file: 'ghostty', args: ['-e', ...remoteExecArgs] },
            ]
          : [{ file: 'ghostty', args: ['-e', ...remoteExecArgs] }];

      await this.launchRemoteTerminal('Ghostty', attempts);
      return;
    }

    if (appId === 'kitty') {
      const remoteExecArgs = buildRemoteTerminalExecArgs({
        host,
        username,
        port,
        targetPath: target,
      });
      const attempts =
        platform === 'darwin'
          ? [
              {
                file: 'open',
                args: ['-n', '-b', 'net.kovidgoyal.kitty', '--args', ...remoteExecArgs],
              },
              { file: 'open', args: ['-na', 'kitty', '--args', ...remoteExecArgs] },
              { file: 'kitty', args: remoteExecArgs },
            ]
          : [{ file: 'kitty', args: remoteExecArgs }];

      await this.launchRemoteTerminal('Kitty', attempts);
      return;
    }

    if (appConfig?.supportsRemote) {
      throw new Error(`Remote SSH not yet implemented for ${label}`);
    }
  }

  private async launchRemoteTerminal(
    label: string,
    attempts: RemoteTerminalLaunchAttempt[]
  ): Promise<void> {
    let lastError: unknown = null;
    for (const attempt of attempts) {
      try {
        await execFileCommand(attempt.file, attempt.args);
        return;
      } catch (error) {
        lastError = error;
      }
    }
    if (lastError instanceof Error) throw lastError;
    throw new Error(`Unable to launch ${label}`);
  }

  private async openInLocal(args: {
    label: string;
    target: string;
    platformConfig: PlatformConfig | undefined;
    location: OpenFileLocation | null;
  }): Promise<void> {
    const { label, target, platformConfig, location } = args;

    if (platformConfig?.openUrls) {
      for (const urlTemplate of platformConfig.openUrls) {
        const url = urlTemplate
          .replace('{{path_url}}', encodeURIComponent(target))
          .replace('{{path}}', target);
        try {
          await shell.openExternal(url);
          return;
        } catch {
          // try next URL
        }
      }
      throw new Error(
        `${label} is not installed or its URI scheme is not registered on this platform.`
      );
    }

    const command = buildLocalOpenCommand(platformConfig, target, location);

    if (!command) throw new Error('Unsupported platform or app');
    const cwd = await resolveOpenCommandCwd(target);

    await new Promise<void>((resolve, reject) => {
      exec(command, { cwd, env: buildExternalToolEnv() }, (err) => {
        if (err) return reject(err);
        resolve();
      });
    });
  }

  async openSelectDirectoryDialog(args: {
    title: string;
    message: string;
  }): Promise<string | undefined> {
    const result = await dialog.showOpenDialog(getMainWindow()!, {
      title: args.title,
      properties: ['openDirectory', 'createDirectory'],
      message: args.message,
    });
    if (result.canceled) return undefined;
    return result.filePaths[0];
  }

  async saveTextFileDialog(
    args: SaveTextFileDialogArgs
  ): Promise<{ canceled: true } | { canceled: false; filePath: string }> {
    if (!args || typeof args.defaultPath !== 'string' || args.defaultPath.trim() === '') {
      throw new Error('Invalid default path');
    }
    if (typeof args.content !== 'string') {
      throw new Error('Invalid file content');
    }

    const result = await dialog.showSaveDialog(getMainWindow()!, {
      title: args.title,
      defaultPath: args.defaultPath,
      filters: args.filters,
    });
    if (result.canceled || !result.filePath) return { canceled: true };

    await writeFile(result.filePath, args.content, 'utf8');
    return { canceled: false, filePath: result.filePath };
  }
}

async function resolveOpenCommandCwd(target: string): Promise<string> {
  try {
    const targetStat = await stat(target);
    return targetStat.isDirectory() ? target : dirname(target);
  } catch {
    return dirname(target);
  }
}

export const appService = new AppService();
