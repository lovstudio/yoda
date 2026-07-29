import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { LovcodeAvailability, LovcodeSearchResult } from '@shared/lovcode';
import type { SearchItem } from '@shared/search';
import { sqlite } from '@main/db/client';
import { log } from '@main/lib/logger';
import {
  detectLovcodeDesktopInstallation,
  type LovcodeDesktopInstallation,
} from './lovcode-desktop-installation';

const execFileAsync = promisify(execFile);
const LOVCODE_BIN = 'lovcode';
const SEARCH_TIMEOUT_MS = 10_000;
const VERSION_TIMEOUT_MS = 3_000;
const MAX_SUBTITLE_LENGTH = 180;

type LovcodeCommandResult = { stdout: string };
type LovcodeCommandRunner = (
  args: string[],
  options: { timeout: number; maxBuffer?: number }
) => Promise<LovcodeCommandResult>;

type LovcodeSearchRow = {
  session_id?: string;
  sessionId?: string;
  content?: string;
  summary?: string;
  title?: string;
};

type LovcodeSearchHit = {
  sessionId: string;
  excerpt: string;
};

export type LovcodeConversationRow = {
  id: string;
  project_id: string;
  project_name: string;
  task_id: string;
  task_name: string;
  title: string;
  last_interacted_at: string | null;
  conversation_archived_at: string | null;
  task_archived_at: string | null;
  agent_session_id: string;
};

type LovcodeConversationLoader = (sessionIds: string[]) => LovcodeConversationRow[];
type LovcodeDesktopDetector = () => Promise<LovcodeDesktopInstallation | null>;

const runLovcodeCommand: LovcodeCommandRunner = async (args, options) => {
  const { stdout } = await execFileAsync(LOVCODE_BIN, args, {
    timeout: options.timeout,
    maxBuffer: options.maxBuffer,
    encoding: 'utf8',
  });
  return { stdout };
};

export class LovcodeService {
  private cachedAvailability: LovcodeAvailability | null = null;
  private cachedCliAvailability: LovcodeAvailability | null = null;

  constructor(
    private readonly runCommand: LovcodeCommandRunner = runLovcodeCommand,
    private readonly loadConversations: LovcodeConversationLoader = loadLovcodeConversations,
    private readonly detectDesktop: LovcodeDesktopDetector = detectLovcodeDesktopInstallation
  ) {}

  async checkAvailability(force = false): Promise<LovcodeAvailability> {
    if (!force && this.cachedAvailability) return this.cachedAvailability;
    const cliAvailability = await this.checkCliAvailability(force);
    if (cliAvailability.status === 'available') {
      this.cachedAvailability = cliAvailability;
      return this.cachedAvailability;
    }

    try {
      const desktop = await this.detectDesktop();
      this.cachedAvailability = desktop
        ? { status: 'available', version: desktop.version, source: 'desktop' }
        : { status: 'not-installed' };
    } catch (err) {
      log.debug('LovcodeService: Lovcode desktop detection failed', { error: String(err) });
      this.cachedAvailability = { status: 'not-installed' };
    }
    return this.cachedAvailability;
  }

  async search(query: string): Promise<LovcodeSearchResult> {
    const cliAvailability = await this.checkCliAvailability();
    if (cliAvailability.status !== 'available') {
      const availability = await this.checkAvailability();
      return availability.status === 'available' && availability.source === 'desktop'
        ? { status: 'desktop-only', version: availability.version }
        : { status: 'not-installed' };
    }

    const trimmed = query.trim();
    if (!trimmed) return { status: 'ok', items: [] };

    try {
      const { stdout } = await this.runCommand(['search', trimmed, '--json'], {
        timeout: SEARCH_TIMEOUT_MS,
        maxBuffer: 16 * 1024 * 1024,
      });
      const hits = parseSearchHits(stdout);
      if (hits.length === 0) return { status: 'ok', items: [] };

      const rows = this.loadConversations(hits.map((hit) => hit.sessionId));
      return { status: 'ok', items: mapLovcodeResults(rows, hits) };
    } catch (err) {
      log.warn('LovcodeService: search failed', { query: trimmed, error: String(err) });
      return { status: 'error' };
    }
  }

  private async checkCliAvailability(force = false): Promise<LovcodeAvailability> {
    if (!force && this.cachedCliAvailability) return this.cachedCliAvailability;
    try {
      const { stdout } = await this.runCommand(['--version'], { timeout: VERSION_TIMEOUT_MS });
      this.cachedCliAvailability = {
        status: 'available',
        version: stdout.trim() || null,
        source: 'cli',
      };
    } catch (err) {
      log.debug('LovcodeService: lovcode CLI not available', { error: String(err) });
      this.cachedCliAvailability = { status: 'not-installed' };
    }
    return this.cachedCliAvailability;
  }
}

export function parseSearchHits(stdout: string): LovcodeSearchHit[] {
  const hits = new Map<string, LovcodeSearchHit>();

  const pushFrom = (row: unknown) => {
    if (!row || typeof row !== 'object') return;
    const value = row as LovcodeSearchRow;
    const sessionId = value.session_id ?? value.sessionId;
    if (typeof sessionId !== 'string' || sessionId.length === 0 || hits.has(sessionId)) return;
    hits.set(sessionId, {
      sessionId,
      excerpt: firstString(value.content, value.summary, value.title),
    });
  };

  const pushParsed = (value: unknown) => {
    if (Array.isArray(value)) {
      value.forEach(pushFrom);
      return;
    }
    if (value && typeof value === 'object' && 'results' in value) {
      const results = (value as { results?: unknown }).results;
      if (Array.isArray(results)) results.forEach(pushFrom);
      return;
    }
    pushFrom(value);
  };

  const trimmed = stdout.trim();
  if (!trimmed) return [];

  try {
    pushParsed(JSON.parse(trimmed) as unknown);
    return Array.from(hits.values());
  } catch {
    // Older Lovcode builds write JSONL with optional diagnostic lines.
  }

  for (const line of trimmed.split('\n')) {
    const candidate = line.trim();
    if (!candidate) continue;
    try {
      pushParsed(JSON.parse(candidate) as unknown);
    } catch {
      // Ignore non-JSON diagnostics.
    }
  }
  return Array.from(hits.values());
}

export function mapLovcodeResults(
  rows: LovcodeConversationRow[],
  hits: LovcodeSearchHit[]
): SearchItem[] {
  const hitBySessionId = new Map(hits.map((hit) => [hit.sessionId, hit]));
  const order = new Map(hits.map((hit, index) => [hit.sessionId, index]));

  return rows
    .flatMap((row): SearchItem[] => {
      const hit = hitBySessionId.get(row.agent_session_id);
      if (!hit) return [];
      const taskArchived = row.task_archived_at !== null;
      const conversationArchived = row.conversation_archived_at !== null;
      const context = [row.project_name, row.task_name, normalizeExcerpt(hit.excerpt)]
        .filter(Boolean)
        .join(' · ');
      return [
        {
          kind: 'conversation',
          id: row.id,
          projectId: row.project_id,
          taskId: row.task_id,
          title: row.title,
          subtitle: context,
          score: order.get(row.agent_session_id) ?? 0,
          archived: taskArchived || conversationArchived,
          taskArchived,
          conversationArchived,
          timestamp: row.last_interacted_at,
        },
      ];
    })
    .sort((a, b) => a.score - b.score);
}

function loadLovcodeConversations(sessionIds: string[]): LovcodeConversationRow[] {
  const uniqueIds = Array.from(new Set(sessionIds));
  if (uniqueIds.length === 0) return [];

  const placeholders = uniqueIds.map(() => '?').join(',');
  const storedSessionId =
    "CASE WHEN json_valid(c.config) THEN json_extract(c.config, '$.sessionSource.sessionId') END";
  return sqlite
    .prepare(
      `SELECT c.id,
              c.project_id,
              p.name AS project_name,
              c.task_id,
              t.name AS task_name,
              c.title,
              c.last_interacted_at,
              c.archived_at AS conversation_archived_at,
              t.archived_at AS task_archived_at,
              COALESCE(${storedSessionId}, c.id) AS agent_session_id
       FROM conversations c
       JOIN tasks t ON t.id = c.task_id
       JOIN projects p ON p.id = c.project_id
       WHERE c.id IN (${placeholders})
          OR ${storedSessionId} IN (${placeholders})`
    )
    .all(...uniqueIds, ...uniqueIds) as LovcodeConversationRow[];
}

function firstString(...values: unknown[]): string {
  return (
    values.find((value): value is string => typeof value === 'string' && value.trim().length > 0) ??
    ''
  );
}

function normalizeExcerpt(value: string): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= MAX_SUBTITLE_LENGTH) return normalized;
  return `${normalized.slice(0, MAX_SUBTITLE_LENGTH - 1)}…`;
}

export const lovcodeService = new LovcodeService();
