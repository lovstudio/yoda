import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, extname, isAbsolute, join, normalize, sep } from 'node:path';
import { promisify } from 'node:util';
import { dialog } from 'electron';
import {
  PROMPT_SOURCE_DEFAULT_REFRESH_MINUTES,
  PROMPT_SOURCE_DEFAULT_TIMEOUT_SECONDS,
  PROMPT_SOURCE_MAX_REFRESH_MINUTES,
  PROMPT_SOURCE_MAX_TIMEOUT_SECONDS,
  PROMPT_SOURCE_MIN_REFRESH_MINUTES,
  PROMPT_SOURCE_MIN_TIMEOUT_SECONDS,
  type PromptSource,
  type PromptSourceError,
  type PromptSourceLoadResult,
  type PromptSourceRefreshResult,
} from '@shared/prompt-library';
import type { IDisposable, IInitializable } from '@main/lib/lifecycle';
import { promptLibraryService } from './prompt-library-service';

const execFileAsync = promisify(execFile);
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

type GitSourceInput = {
  filePath: string;
  ref?: string;
  refreshIntervalMinutes?: number;
  repositoryUrl: string;
  timeoutSeconds?: number;
};

class PromptSourceLoadError extends Error {
  constructor(readonly sourceError: PromptSourceError) {
    super(sourceError.code);
  }
}

function sourceError(code: PromptSourceError['code'], detail?: string): PromptSourceLoadError {
  return new PromptSourceLoadError({ code, ...(detail ? { detail } : {}) });
}

function toSourceError(error: unknown, fallbackCode: PromptSourceError['code']) {
  if (error instanceof PromptSourceLoadError) return error.sourceError;
  return {
    code: fallbackCode,
    detail: error instanceof Error ? error.message : String(error),
  } satisfies PromptSourceError;
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

function normalizeContentUrl(url: URL): URL {
  if (url.hostname !== 'gist.github.com') return url;
  const [owner, gistId] = url.pathname.split('/').filter(Boolean);
  if (!owner || !gistId) return url;
  return new URL(`https://gist.githubusercontent.com/${owner}/${gistId}/raw`);
}

function cleanHeading(value: string): string {
  return value
    .replace(/\s+#+\s*$/, '')
    .replace(/^([*_`~])(.+)\1$/, '$2')
    .trim();
}

export function derivePromptName(content: string, fallback: string): string {
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

function sameSourceTarget(current: PromptSource | undefined, expected: PromptSource) {
  if (!current || current.type !== expected.type) return false;
  if (current.type === 'file' && expected.type === 'file') return current.path === expected.path;
  if (current.type === 'url' && expected.type === 'url') return current.url === expected.url;
  if (current.type === 'git' && expected.type === 'git') {
    return (
      current.repositoryUrl === expected.repositoryUrl &&
      current.filePath === expected.filePath &&
      current.ref === expected.ref
    );
  }
  return false;
}

function normalizeGitPath(rawPath: string): string {
  const value = normalize(rawPath.trim()).split(sep).join('/');
  if (!value || value === '.' || isAbsolute(rawPath) || value === '..' || value.startsWith('../')) {
    throw sourceError('invalid_git_path');
  }
  return value;
}

export class PromptSourceService implements IInitializable, IDisposable {
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

  async selectFile(): Promise<PromptSourceLoadResult> {
    const selection = await dialog.showOpenDialog({
      title: '从文件添加提示词',
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
        source: { type: 'file', path: filePath, lastAttemptedAt: now, lastSyncedAt: now },
      };
    } catch (error) {
      return { status: 'error', error: toSourceError(error, 'file_read_failed') };
    }
  }

  async loadUrl(input: UrlSourceInput): Promise<PromptSourceLoadResult> {
    const refreshIntervalMinutes = clampInteger(
      input.refreshIntervalMinutes,
      PROMPT_SOURCE_DEFAULT_REFRESH_MINUTES,
      PROMPT_SOURCE_MIN_REFRESH_MINUTES,
      PROMPT_SOURCE_MAX_REFRESH_MINUTES
    );
    const timeoutSeconds = clampInteger(
      input.timeoutSeconds,
      PROMPT_SOURCE_DEFAULT_TIMEOUT_SECONDS,
      PROMPT_SOURCE_MIN_TIMEOUT_SECONDS,
      PROMPT_SOURCE_MAX_TIMEOUT_SECONDS
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

  async loadGit(input: GitSourceInput): Promise<PromptSourceLoadResult> {
    const refreshIntervalMinutes = clampInteger(
      input.refreshIntervalMinutes,
      PROMPT_SOURCE_DEFAULT_REFRESH_MINUTES,
      PROMPT_SOURCE_MIN_REFRESH_MINUTES,
      PROMPT_SOURCE_MAX_REFRESH_MINUTES
    );
    const timeoutSeconds = clampInteger(
      input.timeoutSeconds,
      PROMPT_SOURCE_DEFAULT_TIMEOUT_SECONDS,
      PROMPT_SOURCE_MIN_TIMEOUT_SECONDS,
      PROMPT_SOURCE_MAX_TIMEOUT_SECONDS
    );
    try {
      const repositoryUrl = input.repositoryUrl.trim();
      if (!repositoryUrl || repositoryUrl.startsWith('-')) throw sourceError('invalid_url');
      const filePath = normalizeGitPath(input.filePath);
      const ref = input.ref?.trim() || undefined;
      const loaded = await this.loadGitFile({ repositoryUrl, filePath, ref, timeoutSeconds });
      const now = new Date().toISOString();
      return {
        status: 'success',
        ...loaded,
        source: {
          type: 'git',
          repositoryUrl,
          filePath,
          ref,
          refreshIntervalMinutes,
          timeoutSeconds,
          lastAttemptedAt: now,
          lastSyncedAt: now,
        },
      };
    } catch (error) {
      return { status: 'error', error: toSourceError(error, 'git_clone_failed') };
    }
  }

  async refresh(id: string): Promise<PromptSourceRefreshResult> {
    const prompt = (await promptLibraryService.list()).find((item) => item.id === id);
    if (!prompt?.source) return { status: 'error', error: { code: 'source_not_found' } };

    const expectedSource = prompt.source;
    const attemptedAt = new Date().toISOString();
    try {
      const loaded = await this.loadSource(expectedSource);
      const current = (await promptLibraryService.list()).find((item) => item.id === id);
      if (!sameSourceTarget(current?.source, expectedSource)) {
        return { status: 'error', error: { code: 'source_not_found' } };
      }
      const source = {
        ...expectedSource,
        lastAttemptedAt: attemptedAt,
        lastSyncedAt: attemptedAt,
        lastError: undefined,
      } as PromptSource;
      await promptLibraryService.update(id, { content: loaded.text, source });
      await this.reconcile();
      return { status: 'success', text: loaded.text, source };
    } catch (error) {
      const fallback =
        expectedSource.type === 'file'
          ? 'file_read_failed'
          : expectedSource.type === 'git'
            ? 'git_clone_failed'
            : 'request_failed';
      const mapped = toSourceError(error, fallback);
      const current = (await promptLibraryService.list()).find((item) => item.id === id);
      if (sameSourceTarget(current?.source, expectedSource)) {
        await promptLibraryService.update(id, {
          source: { ...expectedSource, lastAttemptedAt: attemptedAt, lastError: mapped },
        });
      }
      await this.reconcile();
      return { status: 'error', error: mapped };
    }
  }

  async reconcile(): Promise<void> {
    this.clearSchedule();
    if (this.disposed) return;

    const items = await promptLibraryService.list();
    const nextDueAt = items.reduce<number | null>((earliest, item) => {
      const source = item.source;
      if (!source || source.type === 'file') return earliest;
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
      void this.refreshDueSources();
    }, delay);
    this.scheduleTimer.unref?.();
  }

  private clearSchedule(): void {
    if (!this.scheduleTimer) return;
    clearTimeout(this.scheduleTimer);
    this.scheduleTimer = null;
  }

  private refreshDueSources(): Promise<void> {
    if (this.refreshDuePromise) return this.refreshDuePromise;
    this.refreshDuePromise = this.doRefreshDueSources().finally(() => {
      this.refreshDuePromise = null;
      void this.reconcile();
    });
    return this.refreshDuePromise;
  }

  private async doRefreshDueSources(): Promise<void> {
    if (this.disposed) return;
    const items = await promptLibraryService.list();
    const now = Date.now();
    const dueIds = items.flatMap((item) => {
      const source = item.source;
      if (!source || source.type === 'file') return [];
      const lastAttempt = source.lastAttemptedAt ?? source.lastSyncedAt;
      const lastAttemptMs = lastAttempt ? Date.parse(lastAttempt) : 0;
      const dueAt =
        (Number.isFinite(lastAttemptMs) ? lastAttemptMs : 0) +
        source.refreshIntervalMinutes * 60_000;
      return dueAt <= now ? [item.id] : [];
    });
    await Promise.all(dueIds.map((id) => this.refresh(id)));
  }

  private async loadSource(source: PromptSource): Promise<LoadedSource> {
    if (source.type === 'file') return this.loadFile(source.path);
    if (source.type === 'url') {
      return (await this.loadRemote(source.url, source.timeoutSeconds)).loaded;
    }
    return this.loadGitFile(source);
  }

  private async loadFile(filePath: string): Promise<LoadedSource> {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) throw sourceError('file_read_failed');
    if (fileStat.size > MAX_SOURCE_BYTES) throw sourceError('too_large');
    const text = await readFile(filePath, 'utf8');
    if (!text.trim()) throw sourceError('empty_content');
    return { name: derivePromptName(text, fileFallbackName(filePath)), text };
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
    url = normalizeContentUrl(url);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutSeconds * 1_000);
    try {
      const response = await fetch(url, {
        headers: { Accept: 'text/markdown, text/plain, text/*;q=0.9, */*;q=0.5' },
        redirect: 'follow',
        signal: controller.signal,
      });
      if (!response.ok) throw sourceError('http_error', String(response.status));
      const text = await readResponseText(response);
      if (!text.trim()) throw sourceError('empty_content');
      return {
        loaded: { name: derivePromptName(text, urlFallbackName(url)), text },
        normalizedUrl: url.toString(),
      };
    } catch (error) {
      if (controller.signal.aborted) throw sourceError('request_timeout');
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  private async loadGitFile(input: {
    filePath: string;
    ref?: string;
    repositoryUrl: string;
    timeoutSeconds: number;
  }): Promise<LoadedSource> {
    const checkoutDir = await mkdtemp(join(tmpdir(), 'yoda-prompt-git-'));
    const cloneArgs = ['clone', '--filter=blob:none', '--no-checkout', '--depth=1'];
    if (input.ref) cloneArgs.push('--branch', input.ref);
    cloneArgs.push('--', input.repositoryUrl, checkoutDir);

    try {
      await execFileAsync('git', cloneArgs, {
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
        timeout: input.timeoutSeconds * 1_000,
        maxBuffer: MAX_SOURCE_BYTES,
      });
      let stdout: string;
      try {
        ({ stdout } = await execFileAsync(
          'git',
          ['-C', checkoutDir, 'show', `HEAD:${input.filePath}`],
          {
            env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
            timeout: input.timeoutSeconds * 1_000,
            maxBuffer: MAX_SOURCE_BYTES,
            encoding: 'utf8',
          }
        ));
      } catch (error) {
        throw sourceError(
          'git_file_not_found',
          error instanceof Error ? error.message : String(error)
        );
      }
      if (Buffer.byteLength(stdout) > MAX_SOURCE_BYTES) throw sourceError('too_large');
      if (!stdout.trim()) throw sourceError('empty_content');
      return {
        name: derivePromptName(stdout, fileFallbackName(input.filePath)),
        text: stdout,
      };
    } catch (error) {
      if (error instanceof PromptSourceLoadError) throw error;
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ETIMEDOUT') throw sourceError('request_timeout');
      throw sourceError('git_clone_failed', error instanceof Error ? error.message : String(error));
    } finally {
      await rm(checkoutDir, { force: true, recursive: true });
    }
  }
}

export const promptSourceService = new PromptSourceService();
