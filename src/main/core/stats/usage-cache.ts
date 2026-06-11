import { readFile, stat } from 'node:fs/promises';
import { getTranscriptUsageReader } from './transcript-readers/registry';
import {
  mergeSessionUsages,
  type SessionTokenUsage,
  type TranscriptUsageReader,
  type UsageReaderContext,
} from './transcript-readers/types';

// Lifetime totals parse every historical session once — size for that.
const MAX_CACHE_ENTRIES = 2000;
// Unresolvable transcripts stay unresolvable for a while; re-check sparsely
// so a brand-new session's transcript is still picked up soon after it lands.
const NEGATIVE_PATH_TTL_MS = 60_000;
// Resolved path sets go stale too: subagent transcripts appear mid-session.
// Codex re-resolution is one SQLite lookup — cheap at this cadence.
const PATH_REFRESH_TTL_MS = 5 * 60_000;

type CacheEntry = {
  mtimeMs: number;
  usage: SessionTokenUsage | null;
};

type PathEntry = {
  paths: string[];
  resolvedAtMs: number;
};

/**
 * Parsed transcript usage, keyed by transcript path and invalidated by file
 * mtime. A session can span several files (main transcript + subagent
 * transcripts); each file is cached independently and merged per call.
 * Resolved path sets are cached per conversation with a refresh TTL.
 * Transcripts live under `~/.claude` / `~/.codex` and survive worktree
 * teardown, so no DB persistence is needed.
 */
class SessionUsageCache {
  private byPath = new Map<string, CacheEntry>();
  private pathsByConversation = new Map<string, PathEntry>();

  async getUsage(
    runtimeId: string | null,
    ctx: UsageReaderContext
  ): Promise<SessionTokenUsage | null> {
    const reader = getTranscriptUsageReader(runtimeId);
    if (!reader) return null;

    const now = Date.now();
    let entry = this.pathsByConversation.get(ctx.conversationId);
    const ttl = entry && entry.paths.length === 0 ? NEGATIVE_PATH_TTL_MS : PATH_REFRESH_TTL_MS;
    if (!entry || now - entry.resolvedAtMs > ttl) {
      entry = { paths: await reader.resolveTranscriptPaths(ctx), resolvedAtMs: now };
      this.pathsByConversation.set(ctx.conversationId, entry);
    }
    return this.getUsageForPaths(runtimeId, entry.paths);
  }

  /**
   * Parse an explicit transcript file set as one session — used for
   * auxiliary-directory sessions that have no conversation record (and thus
   * nothing to resolve). Same per-file mtime cache as `getUsage`.
   */
  async getUsageForPaths(runtimeId: string | null, paths: string[]) {
    const reader = getTranscriptUsageReader(runtimeId);
    if (!reader || paths.length === 0) return null;
    const usages: SessionTokenUsage[] = [];
    for (const path of paths) {
      const usage = await this.getPathUsage(path, reader);
      if (usage) usages.push(usage);
    }
    return mergeSessionUsages(usages);
  }

  private async getPathUsage(
    path: string,
    reader: TranscriptUsageReader
  ): Promise<SessionTokenUsage | null> {
    let mtimeMs: number;
    try {
      mtimeMs = (await stat(path)).mtimeMs;
    } catch {
      return null;
    }

    const cached = this.byPath.get(path);
    if (cached && cached.mtimeMs === mtimeMs) return cached.usage;

    let raw: string;
    try {
      raw = await readFile(path, 'utf8');
    } catch {
      return null;
    }
    const usage = reader.parseUsage(raw);
    this.byPath.set(path, { mtimeMs, usage });
    this.evict();
    return usage;
  }

  private evict(): void {
    while (this.byPath.size > MAX_CACHE_ENTRIES) {
      const oldest = this.byPath.keys().next().value;
      if (oldest === undefined) return;
      this.byPath.delete(oldest);
    }
  }
}

export const sessionUsageCache = new SessionUsageCache();
