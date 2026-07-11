import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import type { Readable } from 'node:stream';
import type { Session } from 'electron';
import type { UpdateInfo } from 'electron-updater';
import {
  findAvailableSparkleUpdate,
  sparkleFeedUrlForArch,
  type SparkleAppcastUpdate,
} from '@shared/sparkle-appcast';
import { startSparkleFeedProxy, type SparkleFeedProxy } from './sparkle-feed-proxy';

type HelperProcess = ChildProcess & { stdout: Readable; stderr: Readable };
type SpawnHelper = (command: string, args: string[]) => HelperProcess;

export type SparkleDownloadProgress = {
  bytesPerSecond: number;
  percent: number;
  transferred: number;
  total: number;
};

export type SparkleHelperEvent =
  | { type: 'update-found'; version: string; delta: boolean }
  | { type: 'download-start'; total: number }
  | { type: 'download-progress'; transferred: number; total: number }
  | { type: 'ready-to-install' }
  | { type: 'installing' }
  | { type: 'full-update-blocked'; version: string };

type PendingSparkleUpdate = {
  appcast: string;
  feedUrl: string;
  update: SparkleAppcastUpdate;
};

type MacSparkleUpdaterOptions = {
  arch?: string;
  executablePath?: string;
  spawnHelper?: SpawnHelper;
  startFeedProxy?: typeof startSparkleFeedProxy;
  now?: () => number;
};

export class MacSparkleUpdater {
  private readonly arch: string;
  private readonly appBundlePath: string;
  private readonly helperPath: string;
  private readonly spawnHelper: SpawnHelper;
  private readonly startFeedProxy: typeof startSparkleFeedProxy;
  private readonly now: () => number;
  private pending: PendingSparkleUpdate | null = null;
  private activeDownloadProcess: HelperProcess | null = null;
  private activeDownloadProxy: SparkleFeedProxy | null = null;
  private installProcess: HelperProcess | null = null;
  private installProxy: SparkleFeedProxy | null = null;

  constructor(options: MacSparkleUpdaterOptions = {}) {
    this.arch = options.arch ?? process.arch;
    const paths = resolveSparkleRuntimePaths(options.executablePath ?? process.execPath);
    this.appBundlePath = paths.appBundlePath;
    this.helperPath = paths.helperPath;
    this.spawnHelper = options.spawnHelper ?? defaultSpawnHelper;
    this.startFeedProxy = options.startFeedProxy ?? startSparkleFeedProxy;
    this.now = options.now ?? Date.now;
  }

  async check(
    feedBaseUrl: string,
    currentVersion: string,
    updateSession: Session
  ): Promise<UpdateInfo | null> {
    this.assertRuntimeAvailable();
    const feedUrl = sparkleFeedUrlForArch(feedBaseUrl, this.arch);
    const response = await updateSession.fetch(feedUrl, {
      headers: { 'Cache-Control': 'no-cache', Accept: 'application/rss+xml, application/xml' },
    });
    if (!response.ok) {
      throw new Error(`Sparkle appcast request failed with HTTP ${response.status}`);
    }

    const appcast = await response.text();
    const update = findAvailableSparkleUpdate(appcast, currentVersion);
    if (!update) {
      this.pending = null;
      return null;
    }

    this.pending = { appcast, feedUrl, update };
    const { delta, releaseDate, releaseNotes } = update;
    return {
      version: delta.toVersion,
      files: [{ url: delta.url, sha512: '', size: delta.length }],
      path: delta.url,
      sha512: '',
      releaseDate: releaseDate ?? new Date(0).toISOString(),
      releaseNotes: releaseNotes ?? null,
    };
  }

  async download(
    updateSession: Session,
    onProgress: (progress: SparkleDownloadProgress) => void
  ): Promise<void> {
    const pending = this.requirePendingUpdate();
    const proxy = await this.startFeedProxy(
      pending.appcast,
      pending.update.delta.url,
      updateSession
    );
    this.activeDownloadProxy = proxy;

    try {
      const process = this.spawnHelper(
        this.helperPath,
        buildSparkleHelperArgs(this.appBundlePath, proxy.feedUrl, 'download')
      );
      this.activeDownloadProcess = process;
      await this.waitForDownload(process, pending.update, onProgress);
    } finally {
      this.activeDownloadProcess = null;
      this.activeDownloadProxy = null;
      await proxy.close();
    }
  }

  async launchInstall(updateSession: Session): Promise<void> {
    const pending = this.requirePendingUpdate();
    if (this.installProcess) return;

    const proxy = await this.startFeedProxy(
      pending.appcast,
      pending.update.delta.url,
      updateSession
    );
    const process = this.spawnHelper(
      this.helperPath,
      buildSparkleHelperArgs(this.appBundlePath, proxy.feedUrl, 'install')
    );
    this.installProxy = proxy;
    this.installProcess = process;

    try {
      await waitForInstallHandoff(process);
    } catch (error) {
      this.installProcess = null;
      this.installProxy = null;
      process.kill('SIGTERM');
      await proxy.close();
      throw error;
    }

    process.once('exit', () => {
      this.installProcess = null;
      const activeProxy = this.installProxy;
      this.installProxy = null;
      void activeProxy?.close();
    });
  }

  dispose(): void {
    this.activeDownloadProcess?.kill('SIGTERM');
    this.activeDownloadProcess = null;
    const proxy = this.activeDownloadProxy;
    this.activeDownloadProxy = null;
    void proxy?.close();
  }

  private assertRuntimeAvailable(): void {
    if (!this.appBundlePath.endsWith('.app') || !existsSync(this.appBundlePath)) {
      throw new Error(`Sparkle requires a packaged macOS app: ${this.appBundlePath}`);
    }
    if (!existsSync(this.helperPath)) {
      throw new Error(`Sparkle update helper is missing: ${this.helperPath}`);
    }
  }

  private requirePendingUpdate(): PendingSparkleUpdate {
    if (!this.pending) throw new Error('No verified Sparkle delta is available');
    return this.pending;
  }

  private async waitForDownload(
    process: HelperProcess,
    update: SparkleAppcastUpdate,
    onProgress: (progress: SparkleDownloadProgress) => void
  ): Promise<void> {
    const startedAt = this.now();
    let ready = false;
    let blockedError: Error | null = null;
    const output: string[] = [];

    observeLines(process, (line) => {
      output.push(line);
      if (output.length > 30) output.shift();
      const event = parseSparkleHelperEvent(line);
      if (!event) return;

      if (event.type === 'full-update-blocked' || (event.type === 'update-found' && !event.delta)) {
        blockedError = new Error('Sparkle refused a full application update');
        process.kill('SIGTERM');
        return;
      }
      if (event.type === 'download-start' && event.total > update.delta.length) {
        blockedError = new Error('Sparkle download exceeds the verified delta size');
        process.kill('SIGTERM');
        return;
      }
      if (event.type === 'download-progress') {
        if (event.transferred > update.delta.length) {
          blockedError = new Error('Sparkle transferred more than the verified delta size');
          process.kill('SIGTERM');
          return;
        }
        const elapsedSeconds = Math.max((this.now() - startedAt) / 1000, 0.001);
        onProgress({
          bytesPerSecond: event.transferred / elapsedSeconds,
          percent: event.total > 0 ? (event.transferred / event.total) * 100 : 0,
          transferred: event.transferred,
          total: event.total,
        });
      }
      if (event.type === 'ready-to-install') ready = true;
    });

    const result = await waitForExit(process);
    if (blockedError) throw blockedError;
    if (result.code !== 0 || !ready) {
      throw new Error(formatHelperFailure(result, output));
    }
  }
}

export function resolveSparkleRuntimePaths(executablePath: string): {
  appBundlePath: string;
  helperPath: string;
} {
  const appBundlePath = resolve(dirname(executablePath), '..', '..');
  return {
    appBundlePath,
    helperPath: join(appBundlePath, 'Contents', 'Helpers', 'YodaSparkleUpdater'),
  };
}

export function buildSparkleHelperArgs(
  appBundlePath: string,
  feedUrl: string,
  mode: 'download' | 'install'
): string[] {
  return [
    appBundlePath,
    '--application',
    appBundlePath,
    '--feed-url',
    feedUrl,
    '--user-agent-name',
    'Yoda',
    '--check-immediately',
    ...(mode === 'download' ? ['--defer-install'] : []),
  ];
}

export function parseSparkleHelperEvent(line: string): SparkleHelperEvent | null {
  const marker = 'YODA_EVENT ';
  const markerIndex = line.indexOf(marker);
  if (markerIndex === -1) return null;
  try {
    const candidate = JSON.parse(line.slice(markerIndex + marker.length)) as Record<
      string,
      unknown
    >;
    switch (candidate.type) {
      case 'update-found':
        if (typeof candidate.version === 'string' && typeof candidate.delta === 'boolean') {
          return { type: candidate.type, version: candidate.version, delta: candidate.delta };
        }
        break;
      case 'download-start':
        if (isNonNegativeNumber(candidate.total)) {
          return { type: candidate.type, total: candidate.total };
        }
        break;
      case 'download-progress':
        if (isNonNegativeNumber(candidate.transferred) && isNonNegativeNumber(candidate.total)) {
          return {
            type: candidate.type,
            transferred: candidate.transferred,
            total: candidate.total,
          };
        }
        break;
      case 'ready-to-install':
      case 'installing':
        return { type: candidate.type };
      case 'full-update-blocked':
        if (typeof candidate.version === 'string') {
          return { type: candidate.type, version: candidate.version };
        }
        break;
    }
  } catch {}
  return null;
}

function defaultSpawnHelper(command: string, args: string[]): HelperProcess {
  return spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] }) as HelperProcess;
}

function observeLines(process: HelperProcess, callback: (line: string) => void): void {
  for (const stream of [process.stdout, process.stderr]) {
    const reader = createInterface({ input: stream });
    reader.on('line', callback);
    process.once('exit', () => reader.close());
  }
}

async function waitForInstallHandoff(process: HelperProcess): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let verifiedDelta = false;
    const timeout = setTimeout(() => {
      reject(new Error('Sparkle install handoff timed out'));
    }, 15_000);

    const finish = (error?: Error) => {
      clearTimeout(timeout);
      if (error) reject(error);
      else resolve();
    };

    observeLines(process, (line) => {
      const event = parseSparkleHelperEvent(line);
      if (!event) return;
      if (event.type === 'full-update-blocked' || (event.type === 'update-found' && !event.delta)) {
        finish(new Error('Sparkle refused a full application update during install'));
      } else if (event.type === 'update-found' && event.delta) {
        verifiedDelta = true;
      } else if (event.type === 'installing' && verifiedDelta) {
        finish();
      }
    });
    process.once('error', (error) => finish(error));
    process.once('exit', (code, signal) => {
      finish(new Error(`Sparkle installer exited before handoff (${code ?? signal ?? 'unknown'})`));
    });
  });
}

async function waitForExit(
  process: HelperProcess
): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  return await new Promise((resolve, reject) => {
    process.once('error', reject);
    process.once('exit', (code, signal) => resolve({ code, signal }));
  });
}

function formatHelperFailure(
  result: { code: number | null; signal: NodeJS.Signals | null },
  output: string[]
): string {
  const reason = result.code === null ? (result.signal ?? 'unknown signal') : `exit ${result.code}`;
  const details = output
    .filter((line) => !line.startsWith('YODA_EVENT '))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(-500);
  return `Sparkle update failed (${reason})${details ? `: ${details}` : ''}`;
}

function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}
