import { readFile, stat } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import { dialog } from 'electron';
import { promptPrinciplesUpdatedChannel } from '@shared/events/appEvents';
import {
  PROMPT_PRINCIPLE_SOURCE_DEFAULT_REFRESH_MINUTES,
  PROMPT_PRINCIPLE_SOURCE_DEFAULT_TIMEOUT_SECONDS,
  PROMPT_PRINCIPLE_SOURCE_MAX_REFRESH_MINUTES,
  PROMPT_PRINCIPLE_SOURCE_MAX_TIMEOUT_SECONDS,
  PROMPT_PRINCIPLE_SOURCE_MIN_REFRESH_MINUTES,
  PROMPT_PRINCIPLE_SOURCE_MIN_TIMEOUT_SECONDS,
  type PromptPrinciple,
  type PromptPrincipleSource,
  type PromptPrincipleSourceError,
  type PromptPrincipleSourceLoadResult,
  type PromptPrincipleSourceRefreshResult,
} from '@shared/project-settings';
import { events } from '@main/lib/events';
import type { IDisposable, IInitializable } from '@main/lib/lifecycle';
import { appSettingsService } from './settings-service';

const MAX_SOURCE_BYTES = 2 * 1024 * 1024;
const MIN_SCHEDULE_DELAY_MS = 1_000;

type LoadedSource = {
  name: string;
  text: string;
};

type UrlSourceInput = {
  refreshIntervalMinutes?: number;
  timeoutSeconds?: number;
  url: string;
};

class PromptPrincipleSourceLoadError extends Error {
  constructor(readonly sourceError: PromptPrincipleSourceError) {
    super(sourceError.code);
  }
}

function sourceError(
  code: PromptPrincipleSourceError['code'],
  detail?: string
): PromptPrincipleSourceLoadError {
  return new PromptPrincipleSourceLoadError({ code, ...(detail ? { detail } : {}) });
}

function toSourceError(error: unknown, fallbackCode: PromptPrincipleSourceError['code']) {
  if (error instanceof PromptPrincipleSourceLoadError) return error.sourceError;
  return {
    code: fallbackCode,
    detail: error instanceof Error ? error.message : String(error),
  } satisfies PromptPrincipleSourceError;
}

function clampInteger(value: number | undefined, fallback: number, min: number, max: number) {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function fileFallbackName(filePath: string): string {
  const filename = basename(filePath);
  return basename(filename, extname(filename)) || filename;
}

function urlFallbackName(url: URL): string {
  const segment = url.pathname.split('/').filter(Boolean).at(-1);
  if (!segment) return url.hostname;
  try {
    return fileFallbackName(decodeURIComponent(segment)) || url.hostname;
  } catch {
    return fileFallbackName(segment) || url.hostname;
  }
}

function cleanHeading(value: string): string {
  return value
    .replace(/\s+#+\s*$/, '')
    .replace(/^([*_`~])(.+)\1$/, '$2')
    .trim();
}

/**
 * Uses the first Markdown level-one heading when present, otherwise the
 * caller-provided filename/URL fallback. Exported for focused contract tests.
 */
export function derivePromptPrincipleName(content: string, fallback: string): string {
  for (const line of content.split(/\r?\n/)) {
    const match = /^\s*#(?!#)\s+(.+?)\s*$/.exec(line);
    if (!match?.[1]) continue;
    const heading = cleanHeading(match[1]);
    if (heading) return heading;
  }
  return fallback;
}

async function readResponseText(response: Response): Promise<string> {
  const contentLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > MAX_SOURCE_BYTES) {
    throw sourceError('too_large');
  }

  if (!response.body) return '';

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let totalBytes = 0;
  let text = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > MAX_SOURCE_BYTES) {
      await reader.cancel();
      throw sourceError('too_large');
    }
    text += decoder.decode(value, { stream: true });
  }

  return text + decoder.decode();
}

function sameSourceTarget(
  current: PromptPrincipleSource | undefined,
  expected: PromptPrincipleSource
) {
  if (!current || current.type !== expected.type) return false;
  if (current.type === 'file' && expected.type === 'file') {
    return current.path === expected.path;
  }
  if (current.type === 'url' && expected.type === 'url') {
    return current.url === expected.url;
  }
  return false;
}

export class PromptPrincipleSourceService implements IInitializable, IDisposable {
  private scheduleTimer: ReturnType<typeof setTimeout> | null = null;
  private refreshDuePromise: Promise<void> | null = null;
  private disposed = false;

  async initialize(): Promise<void> {
    this.disposed = false;
    await this.reconcile();
  }

  dispose(): void {
    this.disposed = true;
    this.clearSchedule();
  }

  async selectFile(): Promise<PromptPrincipleSourceLoadResult> {
    const selection = await dialog.showOpenDialog({
      title: 'Import Prompt Principle',
      filters: [
        {
          name: 'Text files',
          extensions: ['md', 'mdx', 'txt', 'markdown', 'json', 'yaml', 'yml'],
        },
        { name: 'All files', extensions: ['*'] },
      ],
      properties: ['openFile'],
    });
    const filePath = selection.filePaths[0];
    if (selection.canceled || !filePath) return { status: 'cancelled' };

    try {
      const loaded = await this.loadFile(filePath);
      const now = new Date().toISOString();
      return {
        status: 'success',
        ...loaded,
        source: {
          type: 'file',
          path: filePath,
          lastAttemptedAt: now,
          lastSyncedAt: now,
        },
      };
    } catch (error) {
      return { status: 'error', error: toSourceError(error, 'file_read_failed') };
    }
  }

  async loadUrl(input: UrlSourceInput): Promise<PromptPrincipleSourceLoadResult> {
    const refreshIntervalMinutes = clampInteger(
      input.refreshIntervalMinutes,
      PROMPT_PRINCIPLE_SOURCE_DEFAULT_REFRESH_MINUTES,
      PROMPT_PRINCIPLE_SOURCE_MIN_REFRESH_MINUTES,
      PROMPT_PRINCIPLE_SOURCE_MAX_REFRESH_MINUTES
    );
    const timeoutSeconds = clampInteger(
      input.timeoutSeconds,
      PROMPT_PRINCIPLE_SOURCE_DEFAULT_TIMEOUT_SECONDS,
      PROMPT_PRINCIPLE_SOURCE_MIN_TIMEOUT_SECONDS,
      PROMPT_PRINCIPLE_SOURCE_MAX_TIMEOUT_SECONDS
    );

    try {
      const { loaded, normalizedUrl } = await this.loadRemote(input.url, timeoutSeconds);
      const now = new Date().toISOString();
      return {
        status: 'success',
        ...loaded,
        source: {
          type: 'url',
          url: normalizedUrl,
          refreshIntervalMinutes,
          timeoutSeconds,
          lastAttemptedAt: now,
          lastSyncedAt: now,
        },
      };
    } catch (error) {
      return { status: 'error', error: toSourceError(error, 'request_failed') };
    }
  }

  async refresh(id: string): Promise<PromptPrincipleSourceRefreshResult> {
    const settings = await appSettingsService.get('promptPrinciples');
    const principle = settings.items.find((item) => item.id === id);
    if (!principle?.source) {
      return { status: 'error', error: { code: 'source_not_found' } };
    }

    const expectedSource = principle.source;
    const attemptedAt = new Date().toISOString();

    try {
      const loaded =
        expectedSource.type === 'file'
          ? await this.loadFile(expectedSource.path)
          : (await this.loadRemote(expectedSource.url, expectedSource.timeoutSeconds)).loaded;
      const source = await this.persistRefresh(id, expectedSource, attemptedAt, loaded);
      await this.reconcile();
      return { status: 'success', text: loaded.text, source };
    } catch (error) {
      const mapped = toSourceError(
        error,
        expectedSource.type === 'file' ? 'file_read_failed' : 'request_failed'
      );
      await this.persistRefreshError(id, expectedSource, attemptedAt, mapped);
      await this.reconcile();
      return { status: 'error', error: mapped };
    }
  }

  async reconcile(): Promise<void> {
    this.clearSchedule();
    if (this.disposed) return;

    const { items } = await appSettingsService.get('promptPrinciples');
    const nextDueAt = items.reduce<number | null>((earliest, item) => {
      const source = item.source;
      if (source?.type !== 'url' || !source.url.trim()) return earliest;
      const lastAttempt = source.lastAttemptedAt ?? source.lastSyncedAt;
      const lastAttemptMs = lastAttempt ? Date.parse(lastAttempt) : 0;
      const dueAt =
        (Number.isFinite(lastAttemptMs) ? lastAttemptMs : 0) +
        source.refreshIntervalMinutes * 60_000;
      return earliest === null || dueAt < earliest ? dueAt : earliest;
    }, null);

    if (nextDueAt === null) return;
    const delay = Math.max(MIN_SCHEDULE_DELAY_MS, nextDueAt - Date.now());
    this.scheduleTimer = setTimeout(() => {
      this.scheduleTimer = null;
      void this.refreshDueUrls();
    }, delay);
    this.scheduleTimer.unref?.();
  }

  private clearSchedule(): void {
    if (!this.scheduleTimer) return;
    clearTimeout(this.scheduleTimer);
    this.scheduleTimer = null;
  }

  private refreshDueUrls(): Promise<void> {
    if (this.refreshDuePromise) return this.refreshDuePromise;
    this.refreshDuePromise = this.doRefreshDueUrls().finally(() => {
      this.refreshDuePromise = null;
      void this.reconcile();
    });
    return this.refreshDuePromise;
  }

  private async doRefreshDueUrls(): Promise<void> {
    if (this.disposed) return;
    const { items } = await appSettingsService.get('promptPrinciples');
    const now = Date.now();
    const dueIds = items.flatMap((item) => {
      const source = item.source;
      if (source?.type !== 'url' || !source.url.trim()) return [];
      const lastAttempt = source.lastAttemptedAt ?? source.lastSyncedAt;
      const lastAttemptMs = lastAttempt ? Date.parse(lastAttempt) : 0;
      const dueAt =
        (Number.isFinite(lastAttemptMs) ? lastAttemptMs : 0) +
        source.refreshIntervalMinutes * 60_000;
      return dueAt <= now ? [item.id] : [];
    });

    await Promise.all(dueIds.map((id) => this.refresh(id)));
  }

  private async loadFile(filePath: string): Promise<LoadedSource> {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) throw sourceError('file_read_failed');
    if (fileStat.size > MAX_SOURCE_BYTES) throw sourceError('too_large');
    const text = await readFile(filePath, 'utf8');
    if (!text.trim()) throw sourceError('empty_content');
    return {
      name: derivePromptPrincipleName(text, fileFallbackName(filePath)),
      text,
    };
  }

  private async loadRemote(
    rawUrl: string,
    timeoutSeconds: number
  ): Promise<{ loaded: LoadedSource; normalizedUrl: string }> {
    let url: URL;
    try {
      url = new URL(rawUrl.trim());
    } catch {
      throw sourceError('invalid_url');
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw sourceError('unsupported_url');
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutSeconds * 1_000);
    try {
      const response = await fetch(url, {
        headers: { Accept: 'text/markdown, text/plain, text/*;q=0.9, */*;q=0.5' },
        redirect: 'follow',
        signal: controller.signal,
      });
      if (!response.ok) {
        throw sourceError('http_error', String(response.status));
      }
      const text = await readResponseText(response);
      if (!text.trim()) throw sourceError('empty_content');
      return {
        loaded: {
          name: derivePromptPrincipleName(text, urlFallbackName(url)),
          text,
        },
        normalizedUrl: url.toString(),
      };
    } catch (error) {
      if (controller.signal.aborted) throw sourceError('request_timeout');
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  private async persistRefresh(
    id: string,
    expectedSource: PromptPrincipleSource,
    attemptedAt: string,
    loaded: LoadedSource
  ): Promise<PromptPrincipleSource> {
    let persistedSource = expectedSource;
    await appSettingsService.updateComputed('promptPrinciples', (current) => ({
      items: current.items.map((item) => {
        if (item.id !== id || !sameSourceTarget(item.source, expectedSource)) return item;
        persistedSource = {
          ...item.source,
          lastAttemptedAt: attemptedAt,
          lastSyncedAt: attemptedAt,
          lastError: undefined,
        } as PromptPrincipleSource;
        return { ...item, text: loaded.text, source: persistedSource };
      }),
    }));
    events.emit(promptPrinciplesUpdatedChannel, undefined);
    return persistedSource;
  }

  private async persistRefreshError(
    id: string,
    expectedSource: PromptPrincipleSource,
    attemptedAt: string,
    error: PromptPrincipleSourceError
  ): Promise<void> {
    await appSettingsService.updateComputed('promptPrinciples', (current) => ({
      items: current.items.map((item): PromptPrinciple => {
        if (item.id !== id || !sameSourceTarget(item.source, expectedSource)) return item;
        return {
          ...item,
          source: {
            ...item.source,
            lastAttemptedAt: attemptedAt,
            lastError: error,
          } as PromptPrincipleSource,
        };
      }),
    }));
    events.emit(promptPrinciplesUpdatedChannel, undefined);
  }
}

export const promptPrincipleSourceService = new PromptPrincipleSourceService();
