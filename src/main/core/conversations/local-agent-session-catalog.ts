import { createHash } from 'node:crypto';
import { existsSync, type Dirent, type Stats } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { basename, join, relative, resolve, sep } from 'node:path';
import Database from 'better-sqlite3';
import type { RuntimeCustomConfig } from '@shared/app-settings';
import type { AgentSessionSource, LocalAgentSession } from '@shared/conversations';
import { resolveCodexStatePath } from '@main/core/session-title/codex-title-source';
import { log } from '@main/lib/logger';
import { iterateFileLines, readFirstFileLine } from '@main/utils/file-lines';
import type { SessionStateRuntimeId } from './session-state-roots';

const MAX_SESSIONS_PER_RUNTIME = 2_000;
const MAX_METADATA_READ_BYTES = 512 * 1024;
const MAX_TRANSCRIPT_TAIL_LINES = 500;
const CACHE_TTL_MS = 30_000;

type RuntimeConfigLoader = (
  runtimeId: SessionStateRuntimeId
) => Promise<RuntimeCustomConfig | undefined>;

export interface SessionStateRootsResolver {
  list(
    runtimeId: SessionStateRuntimeId,
    providerConfig: RuntimeCustomConfig | undefined
  ): Promise<string[]>;
}

type CodexThreadCatalogRow = {
  id: string;
  rolloutPath: string;
  cwd: string;
  title: string;
  modelProvider: string;
  archived: number;
  createdAtMs: number;
  updatedAtMs: number;
};

type CatalogTranscript = {
  filePath: string | null;
  totalLines: number;
  lines: string[];
};

export class LocalAgentSessionCatalog {
  private cachedAt = 0;
  private cache = new Map<string, LocalAgentSession>();
  private refreshPromise: Promise<LocalAgentSession[]> | null = null;

  constructor(
    private readonly rootsCatalog: SessionStateRootsResolver,
    private readonly loadRuntimeConfig: RuntimeConfigLoader
  ) {}

  async list(options: { projectPath?: string } = {}): Promise<LocalAgentSession[]> {
    const sessions =
      Date.now() - this.cachedAt <= CACHE_TTL_MS ? [...this.cache.values()] : await this.refresh();
    return sessions
      .filter((session) => matchesProjectPath(session.cwd, options.projectPath))
      .sort((left, right) => timestampMs(right.updatedAt) - timestampMs(left.updatedAt))
      .slice(0, MAX_SESSIONS_PER_RUNTIME * 2);
  }

  async get(catalogId: string): Promise<LocalAgentSession | undefined> {
    const cached = this.cache.get(catalogId);
    if (cached) {
      if (Date.now() - this.cachedAt > CACHE_TTL_MS) {
        void this.refresh().catch((error) => {
          log.debug('LocalAgentSessionCatalog: background refresh failed', {
            error: String(error),
          });
        });
      }
      return cached;
    }
    await this.refresh();
    return this.cache.get(catalogId);
  }

  async validateSource(source: AgentSessionSource): Promise<LocalAgentSession | undefined> {
    const session = await this.get(source.catalogId);
    if (
      !session ||
      session.runtimeId !== source.runtimeId ||
      session.sessionId !== source.sessionId ||
      resolve(session.stateRoot) !== resolve(source.stateRoot)
    ) {
      return undefined;
    }
    return session;
  }

  async getTranscript(catalogId: string): Promise<CatalogTranscript> {
    const session = await this.get(catalogId);
    if (!session) return { filePath: null, totalLines: 0, lines: [] };
    return readTranscriptTail(session.transcriptPath);
  }

  private async listRuntime(runtimeId: SessionStateRuntimeId): Promise<LocalAgentSession[]> {
    const providerConfig = await this.loadRuntimeConfig(runtimeId);
    const roots = await this.rootsCatalog.list(runtimeId, providerConfig);
    const nested = await Promise.all(
      roots.map((stateRoot) =>
        runtimeId === 'codex' ? listCodexSessions(stateRoot) : listClaudeSessions(stateRoot)
      )
    );
    return deduplicateSessions(nested.flat())
      .sort((left, right) => timestampMs(right.updatedAt) - timestampMs(left.updatedAt))
      .slice(0, MAX_SESSIONS_PER_RUNTIME);
  }

  private refresh(): Promise<LocalAgentSession[]> {
    if (this.refreshPromise) return this.refreshPromise;

    const request = Promise.all([this.listRuntime('claude'), this.listRuntime('codex')])
      .then(([claude, codex]) =>
        deduplicateSessions([...claude, ...codex])
          .sort((left, right) => timestampMs(right.updatedAt) - timestampMs(left.updatedAt))
          .slice(0, MAX_SESSIONS_PER_RUNTIME * 2)
      )
      .then((sessions) => {
        this.remember(sessions);
        return sessions;
      })
      .finally(() => {
        if (this.refreshPromise === request) this.refreshPromise = null;
      });
    this.refreshPromise = request;
    return request;
  }

  private remember(sessions: LocalAgentSession[]): void {
    this.cache = new Map(sessions.map((session) => [session.catalogId, session]));
    this.cachedAt = Date.now();
  }
}

async function listCodexSessions(stateRoot: string): Promise<LocalAgentSession[]> {
  const indexed = readCodexThreadRows(stateRoot);
  const sessions = indexed.map((row) => codexRowToSession(stateRoot, row));
  const indexedPaths = new Set(indexed.map((row) => resolve(row.rolloutPath)));
  const rolloutPaths = (
    await Promise.all([
      listRolloutPaths(join(stateRoot, 'sessions')),
      listRolloutPaths(join(stateRoot, 'archived_sessions')),
    ])
  ).flat();
  for (const rolloutPath of rolloutPaths) {
    if (indexedPaths.has(resolve(rolloutPath))) continue;
    const session = await parseCodexRolloutSession(stateRoot, rolloutPath);
    if (session) sessions.push(session);
  }
  return sessions;
}

function readCodexThreadRows(stateRoot: string): CodexThreadCatalogRow[] {
  const statePath = resolveCodexStatePath(stateRoot);
  if (!existsSync(statePath)) return [];
  let database: Database.Database | undefined;
  try {
    database = new Database(statePath, { readonly: true, fileMustExist: true });
    database.pragma('query_only = ON');
    database.pragma('busy_timeout = 5000');
    return database
      .prepare(
        `
          SELECT
            id,
            rollout_path AS rolloutPath,
            cwd,
            title,
            model_provider AS modelProvider,
            archived,
            COALESCE(created_at_ms, created_at * 1000) AS createdAtMs,
            COALESCE(updated_at_ms, updated_at * 1000) AS updatedAtMs
          FROM threads
          WHERE NULLIF(rollout_path, '') IS NOT NULL
          ORDER BY COALESCE(updated_at_ms, updated_at * 1000) DESC
          LIMIT ?
        `
      )
      .all(MAX_SESSIONS_PER_RUNTIME)
      .flatMap(parseCodexThreadCatalogRow);
  } catch (error) {
    log.debug('LocalAgentSessionCatalog: Codex index read failed', {
      stateRoot,
      error: String(error),
    });
    return [];
  } finally {
    database?.close();
  }
}

function parseCodexThreadCatalogRow(value: unknown): CodexThreadCatalogRow[] {
  if (!value || typeof value !== 'object') return [];
  const row = value as Record<string, unknown>;
  if (
    typeof row.id !== 'string' ||
    typeof row.rolloutPath !== 'string' ||
    typeof row.cwd !== 'string'
  ) {
    return [];
  }
  return [
    {
      id: row.id,
      rolloutPath: row.rolloutPath,
      cwd: row.cwd,
      title: typeof row.title === 'string' ? row.title : row.id,
      modelProvider: typeof row.modelProvider === 'string' ? row.modelProvider : '',
      archived: typeof row.archived === 'number' ? row.archived : 0,
      createdAtMs: typeof row.createdAtMs === 'number' ? row.createdAtMs : 0,
      updatedAtMs: typeof row.updatedAtMs === 'number' ? row.updatedAtMs : 0,
    },
  ];
}

function codexRowToSession(stateRoot: string, row: CodexThreadCatalogRow): LocalAgentSession {
  return {
    catalogId: createLocalAgentSessionCatalogId('codex', stateRoot, row.id),
    runtimeId: 'codex',
    sessionId: row.id,
    stateRoot,
    providerId: row.modelProvider || null,
    cwd: row.cwd,
    title: row.title.trim() || row.id,
    createdAt: isoTimestamp(row.createdAtMs),
    updatedAt: isoTimestamp(row.updatedAtMs),
    transcriptPath: row.rolloutPath,
    archived: row.archived === 1,
  };
}

async function parseCodexRolloutSession(
  stateRoot: string,
  rolloutPath: string
): Promise<LocalAgentSession | undefined> {
  const firstLine = await readFirstFileLine(rolloutPath).catch(() => null);
  const first = parseJsonRecord(firstLine);
  if (first?.type !== 'session_meta') return undefined;
  const payload = asRecord(first.payload);
  const sessionId = stringValue(payload?.id);
  const cwd = stringValue(payload?.cwd);
  if (!sessionId || !cwd) return undefined;
  const fileStat = await stat(rolloutPath).catch(() => undefined);
  let title = '';
  for await (const line of iterateFileLines(rolloutPath, {
    maxReadBytes: MAX_METADATA_READ_BYTES,
  })) {
    const parsed = parseJsonRecord(line);
    const prompt = parsed ? extractCodexUserPrompt(parsed) : undefined;
    if (prompt) {
      title = prompt;
      break;
    }
  }
  const createdAt = stringValue(first.timestamp);
  return {
    catalogId: createLocalAgentSessionCatalogId('codex', stateRoot, sessionId),
    runtimeId: 'codex',
    sessionId,
    stateRoot,
    providerId: stringValue(payload?.model_provider) ?? null,
    cwd,
    title: compactTitle(title) || sessionId,
    createdAt: normalizeIsoTimestamp(createdAt) ?? fileStat?.birthtime.toISOString() ?? null,
    updatedAt: fileStat?.mtime.toISOString() ?? normalizeIsoTimestamp(createdAt),
    transcriptPath: rolloutPath,
    archived: rolloutPath.includes(`${sep}archived_sessions${sep}`),
  };
}

async function listClaudeSessions(stateRoot: string): Promise<LocalAgentSession[]> {
  const projectsRoot = join(stateRoot, 'projects');
  let projectEntries: Dirent<string>[];
  try {
    projectEntries = await readdir(projectsRoot, { withFileTypes: true });
  } catch {
    return [];
  }

  const candidates = (
    await Promise.all(
      projectEntries
        .filter((entry) => entry.isDirectory())
        .map(async (entry) => {
          const directory = join(projectsRoot, entry.name);
          let files: Dirent<string>[];
          try {
            files = await readdir(directory, { withFileTypes: true });
          } catch {
            return [];
          }
          return files
            .filter((file) => file.isFile() && file.name.endsWith('.jsonl'))
            .map((file) => join(directory, file.name));
        })
    )
  ).flat();

  const withStats = (
    await Promise.all(
      candidates.map(async (path) => ({ path, metadata: await stat(path).catch(() => undefined) }))
    )
  )
    .flatMap(
      (entry): Array<{ path: string; metadata: Stats }> =>
        entry.metadata ? [{ path: entry.path, metadata: entry.metadata }] : []
    )
    .sort((left, right) => right.metadata.mtimeMs - left.metadata.mtimeMs)
    .slice(0, MAX_SESSIONS_PER_RUNTIME);

  return (
    await Promise.all(
      withStats.map(({ path, metadata }) => parseClaudeSession(stateRoot, path, metadata))
    )
  ).flatMap((session) => (session ? [session] : []));
}

async function parseClaudeSession(
  stateRoot: string,
  transcriptPath: string,
  metadata: Stats
): Promise<LocalAgentSession | undefined> {
  const filenameSessionId = basename(transcriptPath, '.jsonl');
  let sessionId = filenameSessionId;
  let cwd = '';
  let title = '';
  let createdAt: string | null = null;
  for await (const line of iterateFileLines(transcriptPath, {
    maxReadBytes: MAX_METADATA_READ_BYTES,
  })) {
    const parsed = parseJsonRecord(line);
    if (!parsed) continue;
    sessionId = stringValue(parsed.sessionId) ?? sessionId;
    cwd ||= stringValue(parsed.cwd) ?? '';
    const timestamp = normalizeIsoTimestamp(stringValue(parsed.timestamp));
    createdAt ??= timestamp;
    if (parsed.type === 'custom-title') {
      title = stringValue(parsed.customTitle) ?? title;
    } else if (parsed.type === 'ai-title' && !title) {
      title = stringValue(parsed.aiTitle) ?? title;
    } else if (parsed.type === 'summary' && !title) {
      title = stringValue(parsed.summary) ?? title;
    } else if (parsed.type === 'user' && !title) {
      title = extractClaudeUserPrompt(parsed) ?? title;
    }
    if (cwd && title && createdAt) break;
  }
  if (!cwd) return undefined;
  return {
    catalogId: createLocalAgentSessionCatalogId('claude', stateRoot, sessionId),
    runtimeId: 'claude',
    sessionId,
    stateRoot,
    providerId: null,
    cwd,
    title: compactTitle(title) || sessionId,
    createdAt: createdAt ?? metadata.birthtime.toISOString(),
    updatedAt: metadata.mtime.toISOString(),
    transcriptPath,
    archived: false,
  };
}

async function listRolloutPaths(root: string): Promise<string[]> {
  const paths: string[] = [];
  async function walk(directory: string): Promise<void> {
    let entries: Dirent<string>[];
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    await Promise.all(
      entries.map(async (entry) => {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) {
          await walk(path);
        } else if (
          entry.isFile() &&
          entry.name.startsWith('rollout-') &&
          entry.name.endsWith('.jsonl')
        ) {
          paths.push(path);
        }
      })
    );
  }
  await walk(root);
  return paths.sort((left, right) => right.localeCompare(left)).slice(0, MAX_SESSIONS_PER_RUNTIME);
}

async function readTranscriptTail(filePath: string): Promise<CatalogTranscript> {
  let totalLines = 0;
  const lines: string[] = [];
  try {
    for await (const line of iterateFileLines(filePath)) {
      if (!line.trim()) continue;
      totalLines += 1;
      lines.push(line);
      if (lines.length > MAX_TRANSCRIPT_TAIL_LINES) lines.shift();
    }
  } catch {
    return { filePath, totalLines: 0, lines: [] };
  }
  return { filePath, totalLines, lines };
}

function extractCodexUserPrompt(row: Record<string, unknown>): string | undefined {
  const payload = asRecord(row.payload);
  if (row.type === 'event_msg' && payload?.type === 'user_message') {
    return stringValue(payload.message)?.trim() || undefined;
  }
  if (row.type !== 'response_item' || payload?.type !== 'message' || payload.role !== 'user') {
    return undefined;
  }
  return extractMessageContent(payload.content);
}

function extractClaudeUserPrompt(row: Record<string, unknown>): string | undefined {
  const message = asRecord(row.message);
  return extractMessageContent(message?.content);
}

function extractMessageContent(value: unknown): string | undefined {
  if (typeof value === 'string') return value.trim() || undefined;
  if (!Array.isArray(value)) return undefined;
  const text = value
    .flatMap((item) => {
      const record = asRecord(item);
      if (!record) return [];
      const content = stringValue(record.text) ?? stringValue(record.input_text);
      return content ? [content] : [];
    })
    .join('\n')
    .trim();
  return text || undefined;
}

export function createLocalAgentSessionCatalogId(
  runtimeId: SessionStateRuntimeId,
  stateRoot: string,
  sessionId: string
): string {
  return createHash('sha256')
    .update(`${runtimeId}\0${resolve(stateRoot)}\0${sessionId}`)
    .digest('base64url');
}

function deduplicateSessions(sessions: LocalAgentSession[]): LocalAgentSession[] {
  const byId = new Map<string, LocalAgentSession>();
  for (const session of sessions) {
    const previous = byId.get(session.catalogId);
    if (
      !previous ||
      timestampMs(session.updatedAt) > timestampMs(previous.updatedAt) ||
      (!previous.title && session.title)
    ) {
      byId.set(session.catalogId, session);
    }
  }
  return [...byId.values()];
}

function matchesProjectPath(cwd: string, projectPath: string | undefined): boolean {
  if (!projectPath?.trim()) return true;
  const path = relative(resolve(projectPath), resolve(cwd));
  return path === '' || (!path.startsWith(`..${sep}`) && path !== '..' && !isAbsoluteLike(path));
}

function isAbsoluteLike(path: string): boolean {
  return path.startsWith(sep) || /^[A-Za-z]:[\\/]/.test(path);
}

function compactTitle(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, 160);
}

function parseJsonRecord(value: string | null | undefined): Record<string, unknown> | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value) as unknown;
    return asRecord(parsed);
  } catch {
    return undefined;
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function isoTimestamp(value: number): string | null {
  if (!Number.isFinite(value) || value <= 0) return null;
  return new Date(value).toISOString();
}

function normalizeIsoTimestamp(value: string | undefined): string | null {
  if (!value) return null;
  const milliseconds = Date.parse(value);
  return Number.isNaN(milliseconds) ? null : new Date(milliseconds).toISOString();
}

function timestampMs(value: string | null): number {
  if (!value) return 0;
  const milliseconds = Date.parse(value);
  return Number.isNaN(milliseconds) ? 0 : milliseconds;
}
