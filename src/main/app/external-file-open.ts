import { randomUUID } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { app } from 'electron';
import { externalFileOpenChannel, type ExternalFileOpenTarget } from '@shared/events/appEvents';
import {
  authorizeExternalFilePath,
  normalizeExternalFilePath,
} from '@main/core/fs/external-file-access';
import { events } from '@main/lib/events';
import { extractExternalFilePaths } from './external-file-paths';
import { focusMainWindow, getMainWindow } from './window';

class ExternalFileOpenService {
  private started = false;
  private rendererReady = false;
  private readonly pendingPaths: string[] = [];
  private readonly pendingTargets: ExternalFileOpenTarget[] = [];

  register(): void {
    app.on('open-file', (event, filePath) => {
      event.preventDefault();
      this.open(filePath);
    });

    // On macOS the open-file event carries the initial path. Packaged Windows
    // and Linux launches receive it as a normal command-line argument.
    if (!import.meta.env.DEV) this.enqueueArgv(process.argv);
  }

  start(): void {
    this.started = true;
    this.flushPendingPaths();
  }

  markRendererNotReady(): void {
    this.rendererReady = false;
  }

  consumePendingTargets(): ExternalFileOpenTarget[] {
    this.rendererReady = true;
    const targets = [...this.pendingTargets];
    this.pendingTargets.length = 0;
    return targets;
  }

  enqueueArgv(argv: readonly string[]): boolean {
    const paths = extractExternalFilePaths(argv);
    for (const filePath of paths) this.open(filePath);
    return paths.length > 0;
  }

  /** Authorize a path for the standalone file viewer without opening a tab. */
  authorizePath(rawPath: string): string | null {
    return authorizeExternalFilePath(rawPath);
  }

  async authorizeFromRenderer(rawPath: string): Promise<string> {
    const filePath = normalizeExternalFilePath(rawPath);
    if (!filePath) throw new Error('Invalid file path');
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) throw new Error('Please choose a file.');
    return this.authorizePath(filePath) ?? filePath;
  }

  open(rawPath: string): void {
    const filePath = this.authorizePath(rawPath);
    if (!filePath) return;

    if (!this.started) {
      this.pendingPaths.push(filePath);
      return;
    }

    this.dispatch({ id: randomUUID(), path: filePath });
  }

  async openFromRenderer(rawPath: string): Promise<void> {
    const filePath = await this.authorizeFromRenderer(rawPath);
    this.open(filePath);
  }

  private flushPendingPaths(): void {
    const paths = this.pendingPaths.splice(0);
    for (const filePath of paths) this.open(filePath);
  }

  private dispatch(target: ExternalFileOpenTarget): void {
    focusMainWindow();

    const win = getMainWindow();
    if (!this.rendererReady || !win || win.isDestroyed()) {
      this.pendingTargets.push(target);
      return;
    }

    events.emit(externalFileOpenChannel, target);
  }
}

export const externalFileOpenService = new ExternalFileOpenService();
