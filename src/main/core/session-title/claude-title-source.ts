import { watch, type FSWatcher } from 'node:fs';
import { open, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { log } from '@main/lib/logger';
import type {
  SessionTitleContext,
  SessionTitleSource,
  SessionTitleWatcher,
  TitleListener,
} from './types';

/**
 * Claude Code stores session transcripts at
 *   ~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl
 * where <encoded-cwd> is the slug built by encodeClaudeProjectDir below.
 *
 * Claude appends sentinel rows whenever the session title changes:
 *   {"type":"ai-title","aiTitle":"...","sessionId":"..."}
 *   {"type":"custom-title","customTitle":"...","sessionId":"..."}
 * `customTitle` wins over `aiTitle` when both exist (matches Claude Code's
 * own readLiteMetadata precedence). The `summary` row is /compact output
 * and is intentionally ignored — it is not the auto-title.
 */
export class ClaudeSessionTitleSource implements SessionTitleSource {
  readonly runtimeId = 'claude' as const;

  watch(ctx: SessionTitleContext, onTitle: TitleListener): SessionTitleWatcher {
    const filePath = ctx.stateRoot
      ? resolveClaudeTranscriptPathFromConfigDir(
          ctx.cwd,
          ctx.agentSessionId ?? ctx.conversationId,
          ctx.stateRoot
        )
      : resolveClaudeTranscriptPath(ctx.cwd, ctx.agentSessionId ?? ctx.conversationId);
    return new ClaudeTranscriptTailer(filePath, onTitle);
  }
}

/**
 * Claude Code's project-directory slug: EVERY character outside [a-zA-Z0-9]
 * becomes '-', not just '/' and '.'. A CJK project path such as
 * `/Users/x/repos/手工川ai剪辑` lands in `-Users-x-repos----ai--`, so an encoder
 * that only rewrites separators points at a directory that never exists and
 * every transcript-backed surface (prompt history, session title, run state,
 * usage stats) silently reads nothing.
 *
 * Slugs longer than the limit are truncated and disambiguated with a hash of
 * the raw path — same as Claude Code, which would otherwise collide long
 * worktree paths that share a prefix.
 */
const CLAUDE_PROJECT_DIR_MAX_LENGTH = 200;

export function encodeClaudeProjectDir(cwd: string): string {
  const slug = cwd.replace(/[^a-zA-Z0-9]/g, '-');
  if (slug.length <= CLAUDE_PROJECT_DIR_MAX_LENGTH) return slug;
  return `${slug.slice(0, CLAUDE_PROJECT_DIR_MAX_LENGTH)}-${claudeProjectDirHash(cwd)}`;
}

/** Claude Code's 32-bit djb2-style hash of the raw cwd, base36. */
function claudeProjectDirHash(cwd: string): string {
  let hash = 0;
  for (let index = 0; index < cwd.length; index++) {
    hash = ((hash << 5) - hash + cwd.charCodeAt(index)) | 0;
  }
  return Math.abs(hash).toString(36);
}

export function resolveClaudeTranscriptPath(cwd: string, sessionId: string): string {
  const configDir = process.env.CLAUDE_CONFIG_DIR?.trim() || join(homedir(), '.claude');
  return resolveClaudeTranscriptPathFromConfigDir(cwd, sessionId, configDir);
}

export function resolveClaudeTranscriptPathFromConfigDir(
  cwd: string,
  sessionId: string,
  configDir: string
): string {
  return join(configDir, 'projects', encodeClaudeProjectDir(cwd), `${sessionId}.jsonl`);
}

const READY_POLL_INTERVAL_MS = 1_000;
const READY_POLL_MAX_MS = 5 * 60_000;

class ClaudeTranscriptTailer implements SessionTitleWatcher {
  private watcher: FSWatcher | undefined;
  private readyTimer: NodeJS.Timeout | undefined;
  private readyDeadline = Date.now() + READY_POLL_MAX_MS;
  private offset = 0;
  private buffer = '';
  private lastTitle: string | undefined;
  private lastTitleSource: 'custom' | 'ai' | undefined;
  private stopped = false;
  private reading = false;
  private pendingRead = false;

  constructor(
    private readonly filePath: string,
    private readonly onTitle: TitleListener
  ) {
    this.waitForFile();
  }

  stop(): void {
    this.stopped = true;
    if (this.readyTimer) {
      clearTimeout(this.readyTimer);
      this.readyTimer = undefined;
    }
    if (this.watcher) {
      try {
        this.watcher.close();
      } catch {}
      this.watcher = undefined;
    }
  }

  private waitForFile(): void {
    if (this.stopped) return;
    stat(this.filePath)
      .then(() => this.attach())
      .catch(() => {
        if (this.stopped || Date.now() > this.readyDeadline) return;
        this.readyTimer = setTimeout(() => this.waitForFile(), READY_POLL_INTERVAL_MS);
      });
  }

  private attach(): void {
    if (this.stopped) return;
    try {
      this.watcher = watch(this.filePath, () => {
        this.scheduleRead();
      });
      this.watcher.on('error', (err) => {
        log.warn('ClaudeSessionTitleSource: watch error', {
          filePath: this.filePath,
          error: String(err),
        });
      });
    } catch (err) {
      log.warn('ClaudeSessionTitleSource: failed to attach watcher', {
        filePath: this.filePath,
        error: String(err),
      });
      return;
    }
    this.scheduleRead();
  }

  private scheduleRead(): void {
    if (this.stopped) return;
    if (this.reading) {
      this.pendingRead = true;
      return;
    }
    this.reading = true;
    void this.readAppended()
      .catch((err) => {
        log.warn('ClaudeSessionTitleSource: read error', {
          filePath: this.filePath,
          error: String(err),
        });
      })
      .finally(() => {
        this.reading = false;
        if (this.pendingRead && !this.stopped) {
          this.pendingRead = false;
          this.scheduleRead();
        }
      });
  }

  private async readAppended(): Promise<void> {
    const fileHandle = await open(this.filePath, 'r').catch(() => undefined);
    if (!fileHandle) return;
    try {
      const stats = await fileHandle.stat();
      if (stats.size < this.offset) {
        this.offset = 0;
        this.buffer = '';
      }
      if (stats.size === this.offset) return;
      const length = stats.size - this.offset;
      const buf = Buffer.alloc(length);
      await fileHandle.read(buf, 0, length, this.offset);
      this.offset = stats.size;
      this.buffer += buf.toString('utf8');

      let nl = this.buffer.indexOf('\n');
      while (nl !== -1) {
        const line = this.buffer.slice(0, nl).trim();
        this.buffer = this.buffer.slice(nl + 1);
        if (line) this.tryEmitTitle(line);
        nl = this.buffer.indexOf('\n');
      }
    } finally {
      await fileHandle.close();
    }
  }

  private tryEmitTitle(line: string): void {
    if (this.stopped) return;
    const parsed = parseTitleRow(line);
    if (!parsed) return;
    // Custom title beats AI title; once we've locked onto a custom title,
    // ignore later ai-title rows for the same session.
    if (parsed.source === 'ai' && this.lastTitleSource === 'custom') return;
    if (parsed.title === this.lastTitle && parsed.source === this.lastTitleSource) return;
    this.lastTitle = parsed.title;
    this.lastTitleSource = parsed.source;
    try {
      this.onTitle(parsed.title);
    } catch (err) {
      log.warn('ClaudeSessionTitleSource: listener threw', { error: String(err) });
    }
  }
}

type ParsedTitle = { title: string; source: 'custom' | 'ai' };

function parseTitleRow(line: string): ParsedTitle | undefined {
  // Cheap pre-filter — most lines are user/assistant/tool_use rows.
  const isCustom = line.includes('"type":"custom-title"');
  const isAi = !isCustom && line.includes('"type":"ai-title"');
  if (!isCustom && !isAi) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null) return undefined;
  const rec = parsed as Record<string, unknown>;
  if (isCustom && rec.type === 'custom-title' && typeof rec.customTitle === 'string') {
    const title = rec.customTitle.trim();
    if (title) return { title, source: 'custom' };
  }
  if (isAi && rec.type === 'ai-title' && typeof rec.aiTitle === 'string') {
    const title = rec.aiTitle.trim();
    if (title) return { title, source: 'ai' };
  }
  return undefined;
}
