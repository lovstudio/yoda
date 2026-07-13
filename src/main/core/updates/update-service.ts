import { app, session, type Session } from 'electron';
import _electronUpdater, {
  type ProgressInfo,
  type UpdateInfo,
  type Logger as UpdaterLogger,
} from 'electron-updater';
import {
  CN_UPDATE_FEED_BASE_URL,
  UPDATE_CHANNEL,
  UPDATE_FEED_BASE_URL,
} from '@shared/app-identity';
import type { UpdatesSettings } from '@shared/app-settings';
import {
  updateAvailableEvent,
  updateCheckingEvent,
  updateDownloadedEvent,
  updateDownloadingEvent,
  updateErrorEvent,
  updateInstallingEvent,
  updateNotAvailableEvent,
  updateProgressEvent,
} from '@shared/events/updateEvents';
import { resolveAppVersion } from '@main/core/app/utils';
import { appSettingsService } from '@main/core/settings/settings-service';
import { events } from '@main/lib/events';
import type { IDisposable, IInitializable } from '@main/lib/lifecycle';
import { log } from '@main/lib/logger';
import { handoffInstallRestart } from './install-restart';
import { MacSparkleUpdater, type SparkleDownloadProgress } from './mac-sparkle-updater';
import { UpdateCheckCoordinator, UpdateCheckTimeoutError } from './update-check-coordinator';
import { UpdateCheckRecoveryGate } from './update-check-recovery-gate';
import { formatUpdaterError, sanitizeUpdaterLogArgs } from './utils';

const { autoUpdater } = _electronUpdater;

const ALLOW_PRERELEASE = false;
const ALLOW_DOWNGRADE = false;
const CHECK_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const CHECK_TIMEOUT_MS = 30 * 1000; // 30 seconds
const STARTUP_DELAY_MS = 30 * 1000; // 30 seconds
const INSTALL_RESTART_GUARD_TIMEOUT_MS = 2 * 60 * 1000;
const USE_SPARKLE = process.platform === 'darwin';

type PrepareInstallRestart = () => Promise<void>;

export interface UpdateState {
  status: 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'installing' | 'error';
  lastCheck?: Date;
  nextCheck?: Date;
  currentVersion: string;
  availableVersion?: string;
  updateInfo?: UpdateInfo;
  downloadProgress?: {
    bytesPerSecond: number;
    percent: number;
    transferred: number;
    total: number;
  };
  error?: string;
  rollbackVersion?: string;
  releaseNotes?: string;
}

class UpdateService implements IInitializable, IDisposable {
  private updateState: UpdateState;
  private checkTimer?: NodeJS.Timeout;
  private readonly checkCoordinator = new UpdateCheckCoordinator<UpdateInfo | null>(
    CHECK_TIMEOUT_MS
  );
  private initialized = false;
  private active = false;
  private installRequested = false;
  private installRestartGuardTimer?: NodeJS.Timeout;
  private readonly checkRecovery = new UpdateCheckRecoveryGate<UpdateInfo | null>();
  private suppressAutoUpdaterCheckEvents = false;
  private prepareInstallRestart: PrepareInstallRestart = async () => {};
  private appliedFeedUrl: string | null = null;
  private appliedFeedSource: UpdatesSettings['source'] | null = null;
  private readonly macUpdater = USE_SPARKLE ? new MacSparkleUpdater() : null;

  constructor() {
    this.updateState = {
      status: 'idle',
      currentVersion: 'unknown',
    };
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;

    this.updateState.currentVersion = await resolveAppVersion();

    if (import.meta.env.DEV) return;

    if (!USE_SPARKLE) {
      this.setupAutoUpdater();
      this.setupEventListeners();
    }
    this.active = true;

    log.info('AutoUpdateService initialized', {
      version: this.updateState.currentVersion,
      channel: UPDATE_CHANNEL,
      backend: USE_SPARKLE ? 'sparkle-delta-only' : 'electron-updater',
    });

    this.scheduleNextCheck(STARTUP_DELAY_MS);
  }

  private setupAutoUpdater(): void {
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.autoRunAppAfterInstall = true;
    autoUpdater.channel = UPDATE_CHANNEL;
    autoUpdater.allowPrerelease = ALLOW_PRERELEASE;
    autoUpdater.allowDowngrade = ALLOW_DOWNGRADE;
    autoUpdater.requestHeaders = { 'Cache-Control': 'no-cache' };

    const updaterLogger: UpdaterLogger = {
      info: (...args: unknown[]) => log.info('[autoUpdater]', ...sanitizeUpdaterLogArgs(args)),
      warn: (...args: unknown[]) => log.warn('[autoUpdater]', ...sanitizeUpdaterLogArgs(args)),
      error: (...args: unknown[]) => log.error('[autoUpdater]', ...sanitizeUpdaterLogArgs(args)),
    };
    autoUpdater.logger = updaterLogger;
  }

  private setupEventListeners(): void {
    autoUpdater.on('checking-for-update', () => {
      if (this.suppressAutoUpdaterCheckEvents) return;
      const shouldEmit = this.updateState.status !== 'checking';
      this.updateState.status = 'checking';
      this.updateState.lastCheck = new Date();
      if (shouldEmit) events.emit(updateCheckingEvent, undefined);
    });

    autoUpdater.on('update-available', (info: UpdateInfo) => {
      if (this.suppressAutoUpdaterCheckEvents) return;
      this.updateState.status = 'available';
      this.updateState.availableVersion = info.version;
      this.updateState.updateInfo = info;
      events.emit(updateAvailableEvent, { version: info.version, updateInfo: info });
    });

    autoUpdater.on('update-not-available', () => {
      if (this.suppressAutoUpdaterCheckEvents) return;
      this.updateState.status = 'idle';
      events.emit(updateNotAvailableEvent, undefined);
    });

    autoUpdater.on('error', (err: Error) => {
      if (this.suppressAutoUpdaterCheckEvents) {
        log.warn('Ignoring auto-updater error while resetting a timed-out check');
        return;
      }
      this.handleUpdaterError(err);
    });

    autoUpdater.on('download-progress', (progressObj: ProgressInfo) => {
      this.updateState.status = 'downloading';
      this.updateState.downloadProgress = {
        bytesPerSecond: progressObj.bytesPerSecond,
        percent: progressObj.percent,
        transferred: progressObj.transferred,
        total: progressObj.total,
      };
      events.emit(updateProgressEvent, {
        bytesPerSecond: progressObj.bytesPerSecond,
        percent: progressObj.percent,
        transferred: progressObj.transferred,
        total: progressObj.total,
      });
    });

    autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
      this.updateState.status = 'downloaded';
      this.updateState.rollbackVersion = this.updateState.currentVersion;
      events.emit(updateDownloadedEvent, { version: info.version });
    });
  }

  private scheduleNextCheck(delay = CHECK_INTERVAL_MS): void {
    if (this.checkTimer) {
      clearTimeout(this.checkTimer);
    }
    this.updateState.nextCheck = new Date(Date.now() + delay);
    this.checkTimer = setTimeout(() => {
      this.checkForUpdates().catch((e) => {
        log.error('Scheduled update check failed:', e);
      });
    }, delay);
  }

  async checkForUpdates(): Promise<UpdateInfo | null> {
    if (!this.active) return null;

    if (
      this.updateState.status === 'downloading' ||
      this.updateState.status === 'downloaded' ||
      this.updateState.status === 'installing'
    ) {
      log.info('Skipping update check while an update is already in progress', {
        status: this.updateState.status,
      });
      return this.updateState.updateInfo ?? null;
    }

    return this.checkCoordinator.run(
      (signal) => this.checkRecovery.track(this._performCheck(signal)),
      (error) => {
        if (!USE_SPARKLE && error instanceof UpdateCheckTimeoutError) {
          this.beginNonMacCheckRecovery();
        }
        if (this.updateState.status !== 'error') this.handleUpdaterError(error);
      },
      () => {
        if (this.active) this.scheduleNextCheck();
      }
    );
  }

  private async _performCheck(signal: AbortSignal): Promise<UpdateInfo | null> {
    if (this.updateState.status === 'error') {
      this.updateState.status = 'idle';
      this.updateState.error = undefined;
    }

    this.beginUpdateCheck();

    await this.checkRecovery.wait();
    this.suppressAutoUpdaterCheckEvents = false;
    throwIfUpdateCheckAborted(signal);

    const feed = await this.applyUpdateSourceConfig();
    throwIfUpdateCheckAborted(signal);
    await this.applyProxyConfig(feed.url);
    throwIfUpdateCheckAborted(signal);

    log.info('Checking for updates...', {
      channel: UPDATE_CHANNEL,
      currentVersion: this.updateState.currentVersion,
      source: feed.source,
      feedUrl: feed.url,
    });

    if (USE_SPARKLE) {
      return await this.performSparkleCheck(feed.url, signal);
    }

    const result = await autoUpdater.checkForUpdatesAndNotify();
    throwIfUpdateCheckAborted(signal);
    return result?.updateInfo ?? null;
  }

  private resolveUpdateFeedConfig(cfg: UpdatesSettings): {
    source: UpdatesSettings['source'];
    url: string;
  } {
    if (cfg.source === 'china') {
      if (CN_UPDATE_FEED_BASE_URL) {
        return { source: 'china', url: CN_UPDATE_FEED_BASE_URL };
      }
      log.warn('China update source requested, but no mirror URL is embedded in this build');
    }

    return { source: 'official', url: UPDATE_FEED_BASE_URL };
  }

  private async applyUpdateSourceConfig(): Promise<{
    source: UpdatesSettings['source'];
    url: string;
  }> {
    const cfg = await appSettingsService.get('updates');
    const feed = this.resolveUpdateFeedConfig(cfg);

    if (feed.url !== this.appliedFeedUrl || feed.source !== this.appliedFeedSource) {
      if (!USE_SPARKLE) autoUpdater.setFeedURL(feed.url);
      this.appliedFeedUrl = feed.url;
      this.appliedFeedSource = feed.source;
      log.info('Updater feed source applied', {
        source: feed.source,
        feedUrl: feed.url,
      });
    }

    return feed;
  }

  /**
   * The updater runs in its own Electron session (partition "electron-updater")
   * and does NOT inherit a shell/CLI proxy. Behind ClashX-style proxies the feed
   * read may succeed via a CDN while the GitHub binary download fails — so we
   * explicitly route the updater session: `custom` uses the user's proxy URL,
   * `auto` follows the OS proxy. Proxy resolution itself is intentionally not
   * awaited here: PAC scripts can hang, and resolving a diagnostic must never
   * block the actual update request.
   */
  private async applyProxyConfig(proxyProbeUrl: string): Promise<void> {
    try {
      const sess = this.getUpdateSession();
      if (!sess) return;

      const cfg = await appSettingsService.get('updates');
      const customUrl = cfg.proxyMode === 'custom' ? cfg.proxyUrl.trim() : '';

      if (customUrl) {
        await sess.setProxy({ proxyRules: customUrl });
        log.info('Updater proxy: custom', { proxyUrl: customUrl });
        return;
      }

      await sess.setProxy({ mode: 'system' });
      log.info('Updater proxy: auto (system)', { probeUrl: proxyProbeUrl });
    } catch (error) {
      log.warn('Failed to apply updater proxy config:', formatUpdaterError(error));
    }
  }

  async downloadUpdate(): Promise<void> {
    if (!this.active) throw new Error('Update service is not active');
    if (this.updateState.status === 'error' && this.updateState.availableVersion) {
      this.updateState.status = 'available';
    }

    if (this.updateState.status !== 'available') {
      throw new Error(`Cannot download: status is "${this.updateState.status}", not "available"`);
    }

    if (!this.updateState.availableVersion) {
      throw new Error('No version information available for download');
    }

    this.updateState.status = 'downloading';
    events.emit(updateDownloadingEvent, { version: this.updateState.availableVersion });

    try {
      await this.applyProxyConfig(this.appliedFeedUrl ?? UPDATE_FEED_BASE_URL);
      if (USE_SPARKLE) {
        await this.requireMacUpdater().download(this.requireUpdateSession(), (progress) => {
          this.handleSparkleProgress(progress);
        });
        this.updateState.status = 'downloaded';
        this.updateState.rollbackVersion = this.updateState.currentVersion;
        events.emit(updateDownloadedEvent, { version: this.updateState.availableVersion });
      } else {
        await autoUpdater.downloadUpdate();
      }
    } catch (error: unknown) {
      const errorMessage = formatUpdaterError(error);
      log.error('Update download failed:', errorMessage, error);

      const version = this.updateState.availableVersion;
      const info = this.updateState.updateInfo;

      this.updateState.status = 'error';
      this.updateState.error = errorMessage;
      this.updateState.availableVersion = version;
      this.updateState.updateInfo = info;

      events.emit(updateErrorEvent, { message: errorMessage });
      throw error;
    }
  }

  setPrepareInstallRestart(handler: PrepareInstallRestart): void {
    this.prepareInstallRestart = handler;
  }

  quitAndInstall(): void {
    if (!this.active) throw new Error('Update service is not active');
    if (this.installRequested) {
      log.info('quitAndInstall ignored: install already requested');
      return;
    }

    if (this.updateState.status !== 'downloaded') {
      throw new Error(
        `Cannot install update: status is "${this.updateState.status}", expected "downloaded"`
      );
    }

    this.installRequested = true;
    this.updateState.status = 'installing';
    events.emit(updateInstallingEvent, undefined);

    log.info('Installing update', {
      fromVersion: this.updateState.currentVersion,
      toVersion: this.updateState.availableVersion,
    });

    const clearGuard = () => {
      if (this.installRestartGuardTimer) {
        clearTimeout(this.installRestartGuardTimer);
        this.installRestartGuardTimer = undefined;
      }
    };

    const rollback = (reason: string) => {
      clearGuard();
      this.installRequested = false;
      this.updateState.status = 'downloaded';
      if (this.updateState.availableVersion) {
        events.emit(updateDownloadedEvent, { version: this.updateState.availableVersion });
      }
      log.error(reason);
    };

    this.installRestartGuardTimer = setTimeout(() => {
      rollback('quitAndInstall timed out before app quit; allowing retry');
    }, INSTALL_RESTART_GUARD_TIMEOUT_MS);

    setTimeout(() => {
      void (async () => {
        if (USE_SPARKLE) {
          await this.applyProxyConfig(this.appliedFeedUrl ?? UPDATE_FEED_BASE_URL);
        }
        await handoffInstallRestart(this.prepareInstallRestart, async () => {
          if (USE_SPARKLE) {
            log.info('Application cleanup completed; handing restart to Sparkle');
            await this.requireMacUpdater().launchInstall(this.requireUpdateSession());
            app.quit();
            return;
          }

          log.info('Application cleanup completed; handing restart to auto-updater');
          autoUpdater.quitAndInstall(false, true);
        });
      })().catch((error) => {
        rollback(`Failed to prepare update restart: ${formatUpdaterError(error)}`);
      });
    }, 250);
  }

  async fetchReleaseNotes(): Promise<string | null> {
    try {
      if (!this.updateState.updateInfo) {
        return null;
      }

      const releaseNotes = this.updateState.updateInfo.releaseNotes;
      if (releaseNotes) {
        const normalizedReleaseNotes =
          typeof releaseNotes === 'string'
            ? releaseNotes
            : releaseNotes
                .map((note) => note.note)
                .filter((note): note is string => typeof note === 'string' && note.length > 0)
                .join('\n\n');
        if (normalizedReleaseNotes) {
          this.updateState.releaseNotes = normalizedReleaseNotes;
          return normalizedReleaseNotes;
        }
      }

      const version = this.updateState.availableVersion;
      if (!version) return null;

      const response = await fetch(
        `https://api.github.com/repos/lovstudio/yoda/releases/tags/v${version}`
      );

      if (response.ok) {
        const data = (await response.json()) as { body?: string };
        const notes = data.body || 'No release notes available';
        this.updateState.releaseNotes = notes;
        return notes;
      }

      return null;
    } catch (error) {
      log.error('Failed to fetch release notes:', error);
      return null;
    }
  }

  getState(): UpdateState {
    return { ...this.updateState };
  }

  isActive(): boolean {
    return this.active;
  }

  dispose(): void {
    this.active = false;
    if (this.checkTimer) {
      clearTimeout(this.checkTimer);
      this.checkTimer = undefined;
    }
    if (this.installRestartGuardTimer) {
      clearTimeout(this.installRestartGuardTimer);
      this.installRestartGuardTimer = undefined;
    }
    this.checkCoordinator.dispose();
    this.macUpdater?.dispose();
  }

  private async performSparkleCheck(
    feedBaseUrl: string,
    signal: AbortSignal
  ): Promise<UpdateInfo | null> {
    try {
      const info = await this.requireMacUpdater().check(
        feedBaseUrl,
        this.updateState.currentVersion,
        this.requireUpdateSession(),
        signal
      );
      throwIfUpdateCheckAborted(signal);
      if (!info) {
        this.updateState.status = 'idle';
        this.updateState.availableVersion = undefined;
        this.updateState.updateInfo = undefined;
        events.emit(updateNotAvailableEvent, undefined);
        return null;
      }

      this.updateState.status = 'available';
      this.updateState.availableVersion = info.version;
      this.updateState.updateInfo = info;
      events.emit(updateAvailableEvent, { version: info.version, updateInfo: info });
      return info;
    } catch (error) {
      if (!signal.aborted) this.handleUpdaterError(error);
      throw error;
    }
  }

  private handleSparkleProgress(progress: SparkleDownloadProgress): void {
    this.updateState.status = 'downloading';
    this.updateState.downloadProgress = progress;
    events.emit(updateProgressEvent, progress);
  }

  private beginUpdateCheck(): void {
    this.updateState.status = 'checking';
    this.updateState.lastCheck = new Date();
    events.emit(updateCheckingEvent, undefined);
  }

  private beginNonMacCheckRecovery(): void {
    this.suppressAutoUpdaterCheckEvents = true;
    const updateSession = this.getUpdateSession();
    this.checkRecovery.begin(
      () => updateSession?.closeAllConnections() ?? Promise.resolve(),
      (error) => {
        log.warn('Failed to reset timed-out updater connections:', formatUpdaterError(error));
      }
    );
  }

  private handleUpdaterError(error: unknown): void {
    const errorMessage = formatUpdaterError(error);
    log.error('Auto-updater error:', errorMessage);

    if (this.updateState.status === 'installing') {
      log.warn('Ignoring auto-updater error while install is in progress');
      return;
    }

    const previousVersion = this.updateState.availableVersion;
    const previousInfo = this.updateState.updateInfo;
    this.updateState.status = 'error';
    this.updateState.error = errorMessage;
    if (previousVersion) {
      this.updateState.availableVersion = previousVersion;
      this.updateState.updateInfo = previousInfo;
    }
    events.emit(updateErrorEvent, { message: errorMessage });
  }

  private getUpdateSession(): Session | undefined {
    return USE_SPARKLE ? session.fromPartition('yoda-sparkle-updater') : autoUpdater.netSession;
  }

  private requireUpdateSession(): Session {
    const updateSession = this.getUpdateSession();
    if (!updateSession) throw new Error('Update network session is unavailable');
    return updateSession;
  }

  private requireMacUpdater(): MacSparkleUpdater {
    if (!this.macUpdater) throw new Error('Sparkle updater is unavailable on this platform');
    return this.macUpdater;
  }
}

export const updateService = new UpdateService();

function throwIfUpdateCheckAborted(signal: AbortSignal): void {
  if (!signal.aborted) return;
  throw signal.reason instanceof Error ? signal.reason : new Error('Update check was cancelled');
}
