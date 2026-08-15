import { existsSync, type Dirent } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import type {
  ClaudeSessionPrompt,
  CodexDynamicTool,
  CodexSessionContext,
  CodexTurnContext,
  SessionCompaction,
  SessionSummary,
  SessionTranscriptMessage,
} from '@shared/conversations';
import {
  findClosestCodexThreadRefByCreatedAt,
  findClosestCodexThreadRefByTitleAndCreatedAt,
  findUniqueCodexThreadRefByCwdAtActivity,
  findUniqueUntitledCodexThreadRefByCwdAfterCreatedAt,
  getClaimedCodexThreadId,
  resolveCodexStatePath,
} from '@main/core/session-title/codex-title-source';
import { log } from '@main/lib/logger';
import { iterateFileLines, readFirstFileLine } from '@main/utils/file-lines';
import { resolveLatestCodexThreadIdInLineage } from './codex-thread-lineage';
import { resolveRuntimeStateDirectory } from './impl/runtime-env';
import { getCodexInstructionFiles } from './instruction-files';
import { scanCodexSkills } from './scanCodexSkills';

type CodexThreadContextRow = {
  id: string;
  cwd: string;
  rolloutPath: string | null;
  title: string;
  model: string | null;
  modelProvider: string | null;
  cliVersion: string | null;
  memoryMode: string | null;
  approvalMode: string | null;
  sandboxPolicy: string | null;
  firstUserMessage: string | null;
};

type ParsedCodexRollout = {
  baseInstructions: string | null;
  developerMessages: ClaudeSessionPrompt[];
  prompts: ClaudeSessionPrompt[];
  compactions: SessionCompaction[];
  messages: SessionTranscriptMessage[];
  turnContexts: CodexTurnContext[];
  dynamicTools: CodexDynamicTool[];
  completedTurnCount: number;
  cliVersion: string | null;
  modelProvider: string | null;
  summary: SessionSummary | null;
};

export type CodexSessionConversation = {
  prompts: ClaudeSessionPrompt[];
  messages: SessionTranscriptMessage[];
  compactions: SessionCompaction[];
};

export type CodexSessionRuntimeMetadata = {
  model: string | null;
  reasoningEffort: string | null;
  serviceTier: string | null;
};

type CodexRolloutReadMode = 'full' | 'harness' | 'conversation' | 'runtime';

type CachedLiveRollout = {
  signature: string;
  lastAccessedAt: number;
  reads: Partial<Record<'conversation' | 'runtime', Promise<ParsedCodexRollout | null>>>;
};

const MAX_CACHED_LIVE_ROLLOUTS = 32;
const liveRolloutCache = new Map<string, CachedLiveRollout>();

type TurnTagged<T> = {
  value: T;
  turnId: string | null;
};

type CodexPromptCandidate = {
  prompt: ClaudeSessionPrompt;
  turnId: string | null;
  order: number;
  source: 'event' | 'response';
};

/**
 * A compaction boundary pinned to the `promptOrder` counter rather than to an
 * array index. Prompts arrive through two rollout channels that are only merged
 * at the end, and a rollback can splice earlier prompts away, so the absolute
 * order is the only stable anchor.
 */
type CodexCompactionAnchor = {
  timestamp: string | null;
  promptOrder: number;
};

/**
 * Codex wraps each compaction summary with this prefix and reinjects it as a
 * `user` message (`prompts/templates/compact/summary_prefix.md`). We match on
 * the prefix to surface the summary instead of treating it as a user prompt.
 */
const CODEX_SUMMARY_PREFIX = 'Another language model started to solve this problem';

type CodexRolloutMeta = {
  id: string;
  cwd: string;
  timestamp: string | null;
  cliVersion: string | null;
  modelProvider: string | null;
  memoryMode: string | null;
};

const MAX_CODEX_ROLLOUT_SCAN_FILES = 500;
const CODEX_HARNESS_PREFIX_BYTES = 8 * 1024 * 1024;
const CODEX_CREATED_AT_MATCH_MAX_DISTANCE_MS = 2 * 60_000;
const SQLITE_TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

export async function getCodexSessionContext(
  cwd: string,
  conversationId: string,
  conversationTitle?: string,
  conversationCreatedAt?: string | null,
  options: {
    codexHome?: string;
    transcriptMode?: 'full' | 'harness';
    reservedThreadIds?: ReadonlySet<string>;
    conversationLastInteractedAt?: string | null;
  } = {}
): Promise<CodexSessionContext | null> {
  const resolved = await resolveCurrentCodexThread(
    cwd,
    conversationId,
    conversationTitle,
    conversationCreatedAt,
    options
  );
  if (!resolved) return null;
  const { codexHome, statePath, thread } = resolved;

  const [parsed, memoryFiles, dbDynamicTools, skills] = await Promise.all([
    loadRolloutContext(
      thread.rolloutPath,
      thread.firstUserMessage,
      options.transcriptMode ?? 'full'
    ),
    getCodexInstructionFiles(cwd),
    loadDynamicTools(statePath, thread.id),
    scanCodexSkills(cwd, { codexHome }),
  ]);

  const rollout = parsed ?? emptyRollout();
  const dynamicTools = dbDynamicTools.length > 0 ? dbDynamicTools : rollout.dynamicTools;

  return {
    threadId: thread.id,
    rolloutPath: thread.rolloutPath,
    title: thread.title,
    cwd: thread.cwd,
    model: thread.model,
    modelProvider: rollout.modelProvider ?? thread.modelProvider,
    cliVersion: rollout.cliVersion ?? thread.cliVersion,
    memoryMode: thread.memoryMode,
    approvalMode: thread.approvalMode,
    sandboxPolicy: thread.sandboxPolicy,
    baseInstructions: rollout.baseInstructions,
    developerMessages: rollout.developerMessages,
    memoryFiles,
    dynamicTools,
    skills,
    skillsListing: formatSkillListing(skills),
    prompts: rollout.prompts,
    messages: rollout.messages,
    compactions: rollout.compactions,
    turnContexts: rollout.turnContexts,
    completedTurnCount: rollout.completedTurnCount,
    summary: rollout.summary,
  };
}

/** Resolve the active rollout without parsing transcript or harness content. */
export async function getCodexSessionRolloutPath(
  cwd: string,
  conversationId: string,
  conversationTitle?: string,
  conversationCreatedAt?: string | null,
  options: {
    codexHome?: string;
    reservedThreadIds?: ReadonlySet<string>;
    conversationLastInteractedAt?: string | null;
  } = {}
): Promise<string | null> {
  const resolved = await resolveCurrentCodexThread(
    cwd,
    conversationId,
    conversationTitle,
    conversationCreatedAt,
    options
  );
  return resolved?.thread.rolloutPath ?? null;
}

/** Prompt-only rollout reader for progressive project-history surfaces. */
export async function getCodexSessionPrompts(
  cwd: string,
  conversationId: string,
  conversationTitle?: string,
  conversationCreatedAt?: string | null,
  options: { codexHome?: string; reservedThreadIds?: ReadonlySet<string> } = {}
): Promise<ClaudeSessionPrompt[]> {
  return (
    (
      await getCodexSessionConversation(
        cwd,
        conversationId,
        conversationTitle,
        conversationCreatedAt,
        options
      )
    )?.prompts ?? []
  );
}

/**
 * Reads only prompt and assistant-message rows for live conversation surfaces.
 * Harness discovery (instructions, skills, and dynamic tools) remains exclusive
 * to getCodexSessionContext and is never part of the polling path.
 */
export async function getCodexSessionConversation(
  cwd: string,
  conversationId: string,
  conversationTitle?: string,
  conversationCreatedAt?: string | null,
  options: {
    codexHome?: string;
    reservedThreadIds?: ReadonlySet<string>;
    conversationLastInteractedAt?: string | null;
  } = {}
): Promise<CodexSessionConversation | null> {
  const resolved = await resolveCurrentCodexThread(
    cwd,
    conversationId,
    conversationTitle,
    conversationCreatedAt,
    options
  );
  if (!resolved) return null;
  const rollout = await loadRolloutContext(
    resolved.thread.rolloutPath,
    resolved.thread.firstUserMessage,
    'conversation'
  );
  if (!rollout) return { prompts: [], messages: [], compactions: [] };
  return {
    prompts: rollout.prompts,
    messages: rollout.messages,
    compactions: rollout.compactions,
  };
}

/** Small runtime-bar payload resolved without loading the full Codex harness. */
export async function getCodexSessionRuntimeMetadata(
  cwd: string,
  conversationId: string,
  conversationTitle?: string,
  conversationCreatedAt?: string | null,
  options: {
    codexHome?: string;
    reservedThreadIds?: ReadonlySet<string>;
    conversationLastInteractedAt?: string | null;
  } = {}
): Promise<CodexSessionRuntimeMetadata | null> {
  const resolved = await resolveCurrentCodexThread(
    cwd,
    conversationId,
    conversationTitle,
    conversationCreatedAt,
    options
  );
  if (!resolved) return null;
  const rollout = await loadRolloutContext(resolved.thread.rolloutPath, null, 'runtime');
  const currentTurn = rollout?.turnContexts.at(-1);
  return {
    model: currentTurn?.model ?? resolved.thread.model?.trim() ?? null,
    reasoningEffort: currentTurn?.effort ?? null,
    serviceTier: currentTurn?.serviceTier ?? null,
  };
}

export async function getCodexSessionModel(
  cwd: string,
  conversationId: string,
  conversationTitle?: string,
  conversationCreatedAt?: string | null,
  options: {
    codexHome?: string;
    reservedThreadIds?: ReadonlySet<string>;
    conversationLastInteractedAt?: string | null;
  } = {}
): Promise<string | null> {
  const resolved = await resolveCurrentCodexThread(
    cwd,
    conversationId,
    conversationTitle,
    conversationCreatedAt,
    options
  );
  return resolved?.thread.model?.trim() || null;
}

function resolveCodexHome(): string {
  return resolveRuntimeStateDirectory('codex', undefined);
}

async function resolveCurrentCodexThread(
  cwd: string,
  conversationId: string,
  conversationTitle: string | undefined,
  conversationCreatedAt: string | null | undefined,
  options: {
    codexHome?: string;
    reservedThreadIds?: ReadonlySet<string>;
    conversationLastInteractedAt?: string | null;
  }
): Promise<{ codexHome: string; statePath: string; thread: CodexThreadContextRow } | null> {
  const codexHome = options.codexHome ?? resolveCodexHome();
  const statePath = resolveCodexStatePath(codexHome);
  const rootThread =
    resolveCodexThread({
      statePath,
      cwd,
      conversationId,
      conversationTitle,
      conversationCreatedAt,
      conversationLastInteractedAt: options.conversationLastInteractedAt,
    }) ??
    (await resolveCodexThreadFromRollouts({
      codexHome,
      cwd,
      conversationId,
      conversationTitle,
      conversationCreatedAt,
    }));
  if (!rootThread) return null;
  const reservedThreadIds =
    options.reservedThreadIds ??
    (await import('./codex-thread-reservations').then(({ getReservedCodexThreadIds }) =>
      getReservedCodexThreadIds(conversationId)
    ));
  const currentThreadId = resolveLatestCodexThreadIdInLineage({
    statePath,
    rootThreadId: rootThread.id,
    reservedThreadIds,
  });
  return {
    codexHome,
    statePath,
    thread:
      currentThreadId === rootThread.id
        ? rootThread
        : (readCodexThreadContext(statePath, currentThreadId) ?? rootThread),
  };
}

async function resolveCodexThreadFromRollouts({
  codexHome,
  cwd,
  conversationId,
  conversationTitle,
  conversationCreatedAt,
}: {
  codexHome: string;
  cwd: string;
  conversationId: string;
  conversationTitle?: string;
  conversationCreatedAt?: string | null;
}): Promise<CodexThreadContextRow | null> {
  const rolloutPaths = await listCodexRolloutPaths(codexHome);
  const title = conversationTitle?.trim();
  const targetCreatedAtMs = parseTimestampMs(conversationCreatedAt);
  let closestCreatedAtRow: { row: CodexThreadContextRow; distanceMs: number } | null = null;
  let uniqueLaterCreatedAtRow: CodexThreadContextRow | null = null;
  let closestMovedPathRow: { row: CodexThreadContextRow; distanceMs: number } | null = null;
  let hasMultipleLaterCreatedAtRows = false;
  let hasMultipleMovedPathRows = false;

  for (const rolloutPath of rolloutPaths) {
    const firstLine = await readFirstFileLine(rolloutPath).catch(() => null);
    const meta = firstLine ? parseCodexRolloutMeta(firstLine) : null;
    if (!meta) continue;

    const sameCwd = meta.cwd === cwd;
    const rowCreatedAtMs = parseTimestampMs(meta.timestamp);
    const movedPathDistanceMs =
      targetCreatedAtMs !== undefined && rowCreatedAtMs !== undefined
        ? Math.abs(rowCreatedAtMs - targetCreatedAtMs)
        : undefined;
    const canCheckMovedPath =
      !sameCwd &&
      meta.id !== conversationId &&
      title &&
      movedPathDistanceMs !== undefined &&
      movedPathDistanceMs <= CODEX_CREATED_AT_MATCH_MAX_DISTANCE_MS;
    if (!sameCwd && meta.id !== conversationId && !canCheckMovedPath) continue;

    const parsed = (await loadRolloutContext(rolloutPath, null, 'conversation')) ?? emptyRollout();
    const firstUserMessage = parsed.prompts[0]?.text ?? null;
    const lastTurnContext = parsed.turnContexts.at(-1);
    const row: CodexThreadContextRow = {
      id: meta.id,
      cwd: meta.cwd,
      rolloutPath,
      title: firstUserMessage ?? title ?? meta.id,
      model: lastTurnContext?.model ?? null,
      modelProvider: parsed.modelProvider ?? meta.modelProvider,
      cliVersion: parsed.cliVersion ?? meta.cliVersion,
      memoryMode: meta.memoryMode,
      approvalMode: lastTurnContext?.approvalPolicy ?? null,
      sandboxPolicy: lastTurnContext?.sandboxPolicy ?? null,
      firstUserMessage,
    };

    if (row.id === conversationId) return row;
    if (!sameCwd) {
      if (
        canCheckMovedPath &&
        movedPathDistanceMs !== undefined &&
        title &&
        matchesCodexTitle(row, title)
      ) {
        if (closestMovedPathRow && closestMovedPathRow.row.id !== row.id) {
          hasMultipleMovedPathRows = true;
        } else {
          closestMovedPathRow = { row, distanceMs: movedPathDistanceMs };
        }
      }
      continue;
    }

    if (title && matchesCodexTitle(row, title)) return row;

    if (targetCreatedAtMs !== undefined && rowCreatedAtMs !== undefined) {
      const distanceMs = Math.abs(rowCreatedAtMs - targetCreatedAtMs);
      if (
        distanceMs <= CODEX_CREATED_AT_MATCH_MAX_DISTANCE_MS &&
        (!closestCreatedAtRow || distanceMs < closestCreatedAtRow.distanceMs)
      ) {
        closestCreatedAtRow = { row, distanceMs };
      }
      if (rowCreatedAtMs >= targetCreatedAtMs && !firstUserMessage) {
        if (uniqueLaterCreatedAtRow && uniqueLaterCreatedAtRow.id !== row.id) {
          hasMultipleLaterCreatedAtRows = true;
        } else {
          uniqueLaterCreatedAtRow = row;
        }
      }
    }
  }

  return (
    closestCreatedAtRow?.row ??
    (hasMultipleMovedPathRows ? null : closestMovedPathRow?.row) ??
    (hasMultipleLaterCreatedAtRows ? null : uniqueLaterCreatedAtRow) ??
    null
  );
}

async function listCodexRolloutPaths(codexHome: string): Promise<string[]> {
  const sessionsRoot = join(codexHome, 'sessions');
  const out: string[] = [];

  async function walk(dir: string): Promise<void> {
    let entries: Dirent<string>[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    await Promise.all(
      entries.map(async (entry) => {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(path);
        } else if (
          entry.isFile() &&
          entry.name.startsWith('rollout-') &&
          entry.name.endsWith('.jsonl')
        ) {
          out.push(path);
        }
      })
    );
  }

  await walk(sessionsRoot);
  return out.sort((a, b) => b.localeCompare(a)).slice(0, MAX_CODEX_ROLLOUT_SCAN_FILES);
}

function parseCodexRolloutMeta(raw: string): CodexRolloutMeta | null {
  const firstLineEnd = raw.indexOf('\n');
  const firstLine = raw.slice(0, firstLineEnd === -1 ? raw.length : firstLineEnd);
  const parsed = firstLine ? safeParse(firstLine) : null;
  if (!parsed || parsed.type !== 'session_meta') return null;
  const payload = objectValue(parsed.payload);
  if (!payload) return null;
  const id = nullableString(payload.id);
  const cwd = nullableString(payload.cwd);
  if (!id || !cwd) return null;
  return {
    id,
    cwd,
    timestamp: nullableString(parsed.timestamp) ?? nullableString(payload.timestamp),
    cliVersion: nullableString(payload.cli_version),
    modelProvider: nullableString(payload.model_provider),
    memoryMode: nullableString(payload.memory_mode),
  };
}

function formatSkillListing(skills: Array<{ name: string; description: string }>): string {
  return skills
    .map((skill) =>
      skill.description ? `- ${skill.name}: ${skill.description}` : `- ${skill.name}`
    )
    .join('\n');
}

function resolveCodexThread({
  statePath,
  cwd,
  conversationId,
  conversationTitle,
  conversationCreatedAt,
  conversationLastInteractedAt,
}: {
  statePath: string;
  cwd: string;
  conversationId: string;
  conversationTitle?: string;
  conversationCreatedAt?: string | null;
  conversationLastInteractedAt?: string | null;
}): CodexThreadContextRow | null {
  const claimedThreadId = getClaimedCodexThreadId(conversationId);
  if (claimedThreadId) {
    const claimed = readCodexThreadContext(statePath, claimedThreadId);
    if (claimed) return claimed;
  }

  const direct = readCodexThreadContext(statePath, conversationId);
  if (direct) return direct;

  const title = conversationTitle?.trim();
  if (title) {
    const byTitle = findCodexThreadByTitle(statePath, cwd, title);
    if (byTitle) return byTitle;
  }

  const lastInteractedAtMs = parseTimestampMs(conversationLastInteractedAt);
  if (lastInteractedAtMs !== undefined) {
    const byActivity = findUniqueCodexThreadRefByCwdAtActivity({
      statePath,
      cwd,
      activityAtMs: lastInteractedAtMs,
      includeArchived: true,
    });
    if (byActivity) return readCodexThreadContext(statePath, byActivity.id);
  }

  const createdAtMs = parseTimestampMs(conversationCreatedAt);
  if (createdAtMs !== undefined) {
    const byCreatedAt = findClosestCodexThreadRefByCreatedAt({
      statePath,
      cwd,
      targetCreatedAtMs: createdAtMs,
      maxDistanceMs: CODEX_CREATED_AT_MATCH_MAX_DISTANCE_MS,
      includeArchived: true,
    });
    if (byCreatedAt) return readCodexThreadContext(statePath, byCreatedAt.id);

    if (title) {
      const byMovedPathTitle = findClosestCodexThreadRefByTitleAndCreatedAt({
        statePath,
        title,
        targetCreatedAtMs: createdAtMs,
        maxDistanceMs: CODEX_CREATED_AT_MATCH_MAX_DISTANCE_MS,
        includeArchived: true,
      });
      if (byMovedPathTitle) return readCodexThreadContext(statePath, byMovedPathTitle.id);
    }

    const uniqueLaterThread = findUniqueUntitledCodexThreadRefByCwdAfterCreatedAt({
      statePath,
      cwd,
      minCreatedAtMs: createdAtMs,
      includeArchived: true,
    });
    if (uniqueLaterThread) return readCodexThreadContext(statePath, uniqueLaterThread.id);
  }

  return null;
}

function readCodexThreadContext(statePath: string, threadId: string): CodexThreadContextRow | null {
  return (
    withCodexState(statePath, (db) => {
      const row = db
        .prepare(
          `
            SELECT
              id,
              cwd,
              NULLIF(rollout_path, '') AS rolloutPath,
              title,
              NULLIF(model, '') AS model,
              NULLIF(model_provider, '') AS modelProvider,
              NULLIF(cli_version, '') AS cliVersion,
              NULLIF(memory_mode, '') AS memoryMode,
              NULLIF(approval_mode, '') AS approvalMode,
              NULLIF(sandbox_policy, '') AS sandboxPolicy,
              NULLIF(first_user_message, '') AS firstUserMessage
            FROM threads
            WHERE id = ?
            LIMIT 1
          `
        )
        .get(threadId);
      return parseCodexThreadContextRow(row);
    }) ?? null
  );
}

function findCodexThreadByTitle(
  statePath: string,
  cwd: string,
  title: string
): CodexThreadContextRow | null {
  return (
    withCodexState(statePath, (db) => {
      const row = db
        .prepare(
          `
            SELECT
              id,
              cwd,
              NULLIF(rollout_path, '') AS rolloutPath,
              title,
              NULLIF(model, '') AS model,
              NULLIF(model_provider, '') AS modelProvider,
              NULLIF(cli_version, '') AS cliVersion,
              NULLIF(memory_mode, '') AS memoryMode,
              NULLIF(approval_mode, '') AS approvalMode,
              NULLIF(sandbox_policy, '') AS sandboxPolicy,
              NULLIF(first_user_message, '') AS firstUserMessage
            FROM threads
            WHERE cwd = ?
              AND archived = 0
              AND (
                title = ?
                OR first_user_message = ?
                OR preview = ?
              )
            ORDER BY COALESCE(updated_at_ms, updated_at * 1000) DESC, id DESC
            LIMIT 1
          `
        )
        .get(cwd, title, title, title);
      return parseCodexThreadContextRow(row);
    }) ?? null
  );
}

function matchesCodexTitle(row: CodexThreadContextRow, title: string): boolean {
  const trimmedTitle = title.trim();
  if (!trimmedTitle) return false;
  const candidates = [row.title, row.firstUserMessage].filter(
    (value): value is string => typeof value === 'string' && value.length > 0
  );
  return candidates.some(
    (candidate) =>
      candidate === trimmedTitle ||
      (trimmedTitle.length >= 16 && candidate.startsWith(trimmedTitle))
  );
}

function parseCodexThreadContextRow(row: unknown): CodexThreadContextRow | null {
  if (!row || typeof row !== 'object') return null;
  const rec = row as Record<string, unknown>;
  const id = stringValue(rec.id);
  const cwd = stringValue(rec.cwd);
  if (!id || !cwd) return null;
  const title = nullableString(rec.title) ?? nullableString(rec.firstUserMessage) ?? id;
  return {
    id,
    cwd,
    rolloutPath: nullableString(rec.rolloutPath),
    title,
    model: nullableString(rec.model),
    modelProvider: nullableString(rec.modelProvider),
    cliVersion: nullableString(rec.cliVersion),
    memoryMode: nullableString(rec.memoryMode),
    approvalMode: nullableString(rec.approvalMode),
    sandboxPolicy: nullableString(rec.sandboxPolicy),
    firstUserMessage: nullableString(rec.firstUserMessage),
  };
}

async function loadRolloutContext(
  path: string | null,
  firstUserMessage: string | null,
  mode: CodexRolloutReadMode = 'full'
): Promise<ParsedCodexRollout | null> {
  if (!path) return null;
  if (mode === 'conversation' || mode === 'runtime') {
    try {
      const metadata = await stat(path);
      const signature = `${metadata.size}:${metadata.mtimeMs}`;
      let cached = liveRolloutCache.get(path);
      if (!cached || cached.signature !== signature) {
        cached = { signature, lastAccessedAt: Date.now(), reads: {} };
        liveRolloutCache.set(path, cached);
      } else {
        cached.lastAccessedAt = Date.now();
      }

      const reusableConversation = mode === 'runtime' ? cached.reads.conversation : undefined;
      if (reusableConversation) return reusableConversation;
      const existing = cached.reads[mode];
      if (existing) return existing;

      const read = loadRolloutContextUncached(path, firstUserMessage, mode);
      cached.reads[mode] = read;
      trimLiveRolloutCache();
      return read;
    } catch {
      return null;
    }
  }
  return loadRolloutContextUncached(path, firstUserMessage, mode);
}

async function loadRolloutContextUncached(
  path: string,
  firstUserMessage: string | null,
  mode: CodexRolloutReadMode
): Promise<ParsedCodexRollout | null> {
  try {
    const relevantLines: string[] = [];
    const lines = iterateFileLines(
      path,
      mode === 'harness' ? { maxReadBytes: CODEX_HARNESS_PREFIX_BYTES } : undefined
    );
    for await (const line of lines) {
      if (isCodexContextLine(line, mode)) relevantLines.push(line);
    }
    return parseCodexRolloutLines(
      relevantLines,
      mode === 'harness' || mode === 'runtime' ? null : firstUserMessage
    );
  } catch {
    return null;
  }
}

function trimLiveRolloutCache(): void {
  while (liveRolloutCache.size > MAX_CACHED_LIVE_ROLLOUTS) {
    let oldestPath: string | undefined;
    let oldestAccess = Number.POSITIVE_INFINITY;
    for (const [path, entry] of liveRolloutCache) {
      if (entry.lastAccessedAt < oldestAccess) {
        oldestPath = path;
        oldestAccess = entry.lastAccessedAt;
      }
    }
    if (!oldestPath) return;
    liveRolloutCache.delete(oldestPath);
  }
}

function isCodexContextLine(line: string, mode: CodexRolloutReadMode): boolean {
  if (line.includes('"turn_context"')) return true;
  if (mode === 'runtime') {
    return (
      line.includes('"event_msg"') &&
      (line.includes('"task_started"') ||
        line.includes('"turn_started"') ||
        line.includes('"user_message"') ||
        line.includes('"turn_aborted"') ||
        line.includes('"thread_rolled_back"'))
    );
  }
  if (mode !== 'conversation' && line.includes('"session_meta"')) return true;
  if (mode === 'harness') {
    return (
      line.includes('"response_item"') && line.includes('"message"') && line.includes('"developer"')
    );
  }
  if (line.includes('"event_msg"')) {
    return (
      line.includes('"task_started"') ||
      line.includes('"turn_started"') ||
      line.includes('"task_complete"') ||
      line.includes('"turn_complete"') ||
      line.includes('"user_message"') ||
      line.includes('"turn_aborted"') ||
      line.includes('"thread_rolled_back"')
    );
  }
  return line.includes('"response_item"') && line.includes('"message"');
}

async function loadDynamicTools(statePath: string, threadId: string): Promise<CodexDynamicTool[]> {
  return (
    withCodexState(statePath, (db) => {
      const rows = db
        .prepare(
          `
            SELECT
              name,
              namespace,
              description,
              input_schema AS inputSchema,
              defer_loading AS deferLoading
            FROM thread_dynamic_tools
            WHERE thread_id = ?
            ORDER BY position ASC
          `
        )
        .all(threadId);
      if (!Array.isArray(rows)) return [];
      return rows.flatMap((row) => {
        const parsed = parseDynamicTool(row);
        return parsed ? [parsed] : [];
      });
    }) ?? []
  );
}

function parseDynamicTool(row: unknown): CodexDynamicTool | null {
  if (!row || typeof row !== 'object') return null;
  const rec = row as Record<string, unknown>;
  const name = stringValue(rec.name);
  if (!name) return null;
  return {
    name,
    namespace: nullableString(rec.namespace),
    description: stringValue(rec.description) ?? '',
    inputSchema: stringValue(rec.inputSchema) ?? '',
    deferLoading: rec.deferLoading === 1 || rec.deferLoading === true,
  };
}

function parseCodexRolloutLines(
  lines: Iterable<string>,
  firstUserMessage: string | null
): ParsedCodexRollout {
  let baseInstructions: string | null = null;
  let cliVersion: string | null = null;
  let modelProvider: string | null = null;
  let dynamicTools: CodexDynamicTool[] = [];
  const developerMessages: Array<TurnTagged<ClaudeSessionPrompt>> = [];
  const eventPrompts: ClaudeSessionPrompt[] = [];
  const eventPromptTurnIds: Array<string | null> = [];
  const eventPromptOrders: number[] = [];
  const responseUserPrompts: ClaudeSessionPrompt[] = [];
  const responsePromptTurnIds: Array<string | null> = [];
  const responsePromptOrders: number[] = [];
  const staleResponsePrompts = new Set<ClaudeSessionPrompt>();
  const messages: Array<TurnTagged<SessionTranscriptMessage>> = [];
  const turnContexts: CodexTurnContext[] = [];
  const activeUserTurnIds: string[] = [];
  const completionCountsByTurnId = new Map<string, number>();
  let currentTurnId: string | null = null;
  let promptOrder = 0;
  let pendingResponseUser: { turnId: string; text: string; prompt: ClaudeSessionPrompt } | null =
    null;
  let completedTurnCount = 0;
  let sawRolloutUserPrompt = false;
  // Keep only the latest compaction summary — later compactions supersede earlier ones.
  let summary: SessionSummary | null = null;
  const compactionAnchors: CodexCompactionAnchor[] = [];

  const markTurnRestorable = (turnId: string): void => {
    markLastPromptForTurn(eventPrompts, eventPromptTurnIds, turnId);
    markLastPromptForTurn(responseUserPrompts, responsePromptTurnIds, turnId);
  };
  const transitionToTurn = (turnId: string | null): void => {
    if (!turnId) return;
    if (pendingResponseUser && turnId !== pendingResponseUser.turnId) {
      pendingResponseUser = null;
    }
    // A different turn can start after an app restart while the provider still
    // considers the previous turn in progress. Only an explicit completion
    // event makes a Codex turn safe to use as thread/fork's lastTurnId.
    currentTurnId = turnId;
  };
  const noteUserTurn = (turnId: string | null): void => {
    if (turnId && !activeUserTurnIds.includes(turnId)) activeUserTurnIds.push(turnId);
  };
  const rollbackTurns = (count: number): void => {
    const removedTurnIds = new Set(
      activeUserTurnIds.splice(Math.max(0, activeUserTurnIds.length - count), count)
    );
    if (removedTurnIds.size === 0) return;

    removePromptsForTurns(eventPrompts, eventPromptTurnIds, removedTurnIds, eventPromptOrders);
    removePromptsForTurns(
      responseUserPrompts,
      responsePromptTurnIds,
      removedTurnIds,
      responsePromptOrders
    );
    removeTaggedTurns(messages, removedTurnIds);
    removeTaggedTurns(developerMessages, removedTurnIds);
    removeTurnContexts(turnContexts, removedTurnIds);
    for (const turnId of removedTurnIds) {
      completedTurnCount -= completionCountsByTurnId.get(turnId) ?? 0;
      completionCountsByTurnId.delete(turnId);
    }

    currentTurnId = null;
    pendingResponseUser = null;
    summary = null;
  };

  for (const line of lines) {
    if (!line) continue;
    const parsed = safeParse(line);
    if (!parsed) continue;
    const timestamp = nullableString(parsed.timestamp);

    if (parsed.type === 'compacted') {
      compactionAnchors.push({ timestamp, promptOrder });
      continue;
    }

    if (parsed.type === 'session_meta') {
      const payload = objectValue(parsed.payload);
      if (!payload) continue;
      cliVersion = nullableString(payload.cli_version) ?? cliVersion;
      modelProvider = nullableString(payload.model_provider) ?? modelProvider;
      const base = objectValue(payload.base_instructions);
      baseInstructions = nullableString(base?.text) ?? baseInstructions;
      dynamicTools = parseSessionMetaDynamicTools(payload.dynamic_tools);
      continue;
    }

    if (parsed.type === 'turn_context') {
      const ctx = parseTurnContext(parsed.payload);
      if (ctx) {
        turnContexts.push(ctx);
        transitionToTurn(ctx.turnId);
      }
      continue;
    }

    if (parsed.type === 'event_msg') {
      const payload = objectValue(parsed.payload);
      if (!payload) continue;
      if (payload.type === 'thread_rolled_back') {
        const count = nonNegativeInteger(payload.num_turns);
        if (count > 0) rollbackTurns(count);
        continue;
      }
      if (payload.type === 'task_started' || payload.type === 'turn_started') {
        transitionToTurn(nullableString(payload.turn_id));
        continue;
      }
      if (payload.type === 'turn_aborted') {
        const abortedTurnId: string | null = nullableString(payload.turn_id) ?? currentTurnId;
        if (abortedTurnId === currentTurnId) currentTurnId = null;
        continue;
      }
      if (payload.type === 'task_complete' || payload.type === 'turn_complete') {
        completedTurnCount += 1;
        const completedTurnId: string | null = nullableString(payload.turn_id) ?? currentTurnId;
        if (completedTurnId) {
          completionCountsByTurnId.set(
            completedTurnId,
            (completionCountsByTurnId.get(completedTurnId) ?? 0) + 1
          );
          markTurnRestorable(completedTurnId);
        }
        if (completedTurnId === currentTurnId) currentTurnId = null;
        const lastAgentMessage = nullableString(payload.last_agent_message);
        if (lastAgentMessage) {
          pushMessage(
            messages,
            {
              id: timestamp ?? `event-assistant-${messages.length}`,
              role: 'assistant',
              text: lastAgentMessage,
              timestamp,
              phase: 'final',
            },
            completedTurnId
          );
        }
        continue;
      }
      if (payload.type !== 'user_message') continue;
      const text = nullableString(payload.message)?.trim();
      if (text) {
        sawRolloutUserPrompt = true;
        const matchingPendingTurnId =
          pendingResponseUser?.text === text ? pendingResponseUser.turnId : null;
        if (pendingResponseUser && matchingPendingTurnId === null) {
          staleResponsePrompts.add(pendingResponseUser.prompt);
          removeMessageForPrompt(messages, pendingResponseUser.prompt);
        }
        const promptTurnId: string | null =
          nullableString(payload.turn_id) ?? matchingPendingTurnId ?? currentTurnId;
        const prompt = {
          id: timestamp ?? `event-user-${eventPrompts.length}`,
          text,
          timestamp,
        };
        eventPrompts.push(prompt);
        eventPromptTurnIds.push(promptTurnId);
        eventPromptOrders.push(promptOrder);
        promptOrder += 1;
        noteUserTurn(promptTurnId);
        if (!currentTurnId && promptTurnId) currentTurnId = promptTurnId;
        pendingResponseUser = null;
        pushMessage(messages, { ...prompt, role: 'user' }, promptTurnId);
      }
      continue;
    }

    if (parsed.type === 'response_item') {
      const payload = objectValue(parsed.payload);
      if (!payload || payload.type !== 'message') continue;
      const metadata = objectValue(payload.internal_chat_message_metadata_passthrough);
      const responseTurnId = nullableString(metadata?.turn_id);
      const text = extractContentText(payload.content)?.trim();
      if (!text) continue;
      if (payload.role === 'developer') {
        developerMessages.push({
          value: {
            id: timestamp ?? `developer-${developerMessages.length}`,
            text,
            timestamp,
          },
          turnId: responseTurnId ?? currentTurnId,
        });
      } else if (payload.role === 'user' && text.startsWith(CODEX_SUMMARY_PREFIX)) {
        summary = { text, timestamp };
      } else if (payload.role === 'user' && !isCodexInternalUserMessage(text)) {
        sawRolloutUserPrompt = true;
        const promptTurnId: string | null = responseTurnId ?? currentTurnId;
        const prompt = {
          id: timestamp ?? `response-user-${responseUserPrompts.length}`,
          text,
          timestamp,
        };
        responseUserPrompts.push(prompt);
        responsePromptTurnIds.push(promptTurnId);
        responsePromptOrders.push(promptOrder);
        promptOrder += 1;
        noteUserTurn(promptTurnId);
        if (!currentTurnId && responseTurnId) currentTurnId = responseTurnId;
        pendingResponseUser = responseTurnId ? { turnId: responseTurnId, text, prompt } : null;
        pushMessage(messages, { ...prompt, role: 'user' }, promptTurnId);
      } else if (payload.role === 'assistant') {
        const phase = payload.phase === 'final_answer' ? 'final' : 'commentary';
        pushMessage(
          messages,
          {
            id: timestamp ?? `response-assistant-${messages.length}`,
            role: 'assistant',
            text,
            timestamp,
            phase,
          },
          responseTurnId ?? currentTurnId
        );
      }
    }
  }

  const mergedCandidates = mergeCodexPromptSources(
    eventPrompts,
    eventPromptTurnIds,
    eventPromptOrders,
    responseUserPrompts,
    responsePromptTurnIds,
    responsePromptOrders,
    staleResponsePrompts,
    firstUserMessage && !sawRolloutUserPrompt
      ? [{ id: 'first-user-message', text: firstUserMessage, timestamp: null }]
      : []
  );
  const prompts = mergedCandidates.map(({ prompt }) => prompt);

  return {
    baseInstructions,
    developerMessages: developerMessages.map((entry) => entry.value),
    prompts,
    compactions: resolveCodexCompactions(compactionAnchors, mergedCandidates),
    messages:
      messages.length > 0
        ? messages.map((entry) => entry.value)
        : prompts.map((prompt) => ({ ...prompt, role: 'user' as const })),
    turnContexts,
    dynamicTools,
    completedTurnCount,
    cliVersion,
    modelProvider,
    summary,
  };
}

/**
 * Codex has emitted user prompts through both `event_msg` and
 * `response_item` across CLI versions. Keep the union instead of letting the
 * presence of one representation hide prompts from the other. A prompt that
 * appears in both streams for the same turn is one logical prompt; prefer the
 * event representation because it carries the canonical rollout timestamp.
 */
function mergeCodexPromptSources(
  eventPrompts: ClaudeSessionPrompt[],
  eventPromptTurnIds: Array<string | null>,
  eventPromptOrders: number[],
  responseUserPrompts: ClaudeSessionPrompt[],
  responsePromptTurnIds: Array<string | null>,
  responsePromptOrders: number[],
  staleResponsePrompts: ReadonlySet<ClaudeSessionPrompt>,
  fallbackPrompts: ClaudeSessionPrompt[]
): CodexPromptCandidate[] {
  const candidates: CodexPromptCandidate[] = [
    ...eventPrompts.map((prompt, sourceIndex) => ({
      prompt,
      turnId: eventPromptTurnIds[sourceIndex] ?? null,
      order: eventPromptOrders[sourceIndex] ?? sourceIndex,
      source: 'event' as const,
    })),
    ...responseUserPrompts.flatMap((prompt, sourceIndex) =>
      staleResponsePrompts.has(prompt)
        ? []
        : [
            {
              prompt,
              turnId: responsePromptTurnIds[sourceIndex] ?? null,
              order: responsePromptOrders[sourceIndex] ?? sourceIndex,
              source: 'response' as const,
            },
          ]
    ),
  ];

  if (candidates.length === 0) {
    return fallbackPrompts.map((prompt, index) => ({
      prompt,
      turnId: null,
      order: index,
      source: 'event' as const,
    }));
  }

  candidates.sort((left, right) => left.order - right.order);
  const merged: CodexPromptCandidate[] = [];
  for (const candidate of candidates) {
    const duplicateIndex = merged.findIndex(
      (existing) =>
        existing.source !== candidate.source &&
        candidate.turnId !== null &&
        existing.turnId === candidate.turnId &&
        existing.prompt.text === candidate.prompt.text
    );
    if (duplicateIndex < 0) {
      merged.push(candidate);
      continue;
    }

    const existing = merged[duplicateIndex];
    if (!existing) continue;
    const preferred =
      existing.source === 'event' || candidate.source !== 'event' ? existing : candidate;
    const other = preferred === existing ? candidate : existing;
    if (!preferred.prompt.restoreTarget && other.prompt.restoreTarget) {
      preferred.prompt.restoreTarget = other.prompt.restoreTarget;
    }
    merged[duplicateIndex] = preferred;
  }

  return merged;
}

/**
 * Resolves each boundary's position in the merged prompt list. An anchor sits
 * after every prompt the rollout emitted before it, which survives both the
 * two-channel merge and turn rollbacks.
 */
function resolveCodexCompactions(
  anchors: readonly CodexCompactionAnchor[],
  merged: readonly CodexPromptCandidate[]
): SessionCompaction[] {
  return anchors.map((anchor) => ({
    afterPromptIndex: merged.filter((candidate) => candidate.order < anchor.promptOrder).length,
    timestamp: anchor.timestamp,
    trigger: null,
    preTokens: null,
    postTokens: null,
  }));
}

function markLastPromptForTurn(
  prompts: ClaudeSessionPrompt[],
  promptTurnIds: Array<string | null>,
  turnId: string
): void {
  for (let index = promptTurnIds.length - 1; index >= 0; index -= 1) {
    if (promptTurnIds[index] !== turnId) continue;
    const prompt = prompts[index];
    if (prompt) {
      prompt.restoreTarget = { kind: 'codex-turn', turnId };
    }
    return;
  }
}

function pushMessage(
  messages: Array<TurnTagged<SessionTranscriptMessage>>,
  message: SessionTranscriptMessage,
  turnId: string | null
): void {
  if (message.role === 'assistant' && message.phase === 'final' && turnId) {
    let existingFinalIndex = -1;
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const entry = messages[index];
      if (
        entry?.turnId === turnId &&
        entry.value.role === 'assistant' &&
        entry.value.phase === 'final'
      ) {
        existingFinalIndex = index;
        break;
      }
    }
    if (existingFinalIndex >= 0) {
      messages[existingFinalIndex] = { value: message, turnId };
      return;
    }
  }

  const previous = messages[messages.length - 1]?.value;
  if (previous?.role === message.role && previous.text === message.text) {
    if (
      previous.role === 'assistant' &&
      message.role === 'assistant' &&
      message.phase === 'final' &&
      previous.phase !== 'final'
    ) {
      previous.phase = 'final';
    }
    return;
  }
  messages.push({ value: message, turnId });
}

function removeMessageForPrompt(
  messages: Array<TurnTagged<SessionTranscriptMessage>>,
  prompt: ClaudeSessionPrompt
): void {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]?.value;
    if (message?.role === 'user' && message.id === prompt.id && message.text === prompt.text) {
      messages.splice(index, 1);
      return;
    }
  }
}

function removePromptsForTurns(
  prompts: ClaudeSessionPrompt[],
  promptTurnIds: Array<string | null>,
  removedTurnIds: ReadonlySet<string>,
  promptOrders?: number[]
): void {
  for (let index = promptTurnIds.length - 1; index >= 0; index -= 1) {
    const turnId = promptTurnIds[index];
    if (!turnId || !removedTurnIds.has(turnId)) continue;
    promptTurnIds.splice(index, 1);
    prompts.splice(index, 1);
    promptOrders?.splice(index, 1);
  }
}

function removeTaggedTurns<T>(
  entries: Array<TurnTagged<T>>,
  removedTurnIds: ReadonlySet<string>
): void {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const turnId = entries[index]?.turnId;
    if (turnId && removedTurnIds.has(turnId)) entries.splice(index, 1);
  }
}

function removeTurnContexts(
  turnContexts: CodexTurnContext[],
  removedTurnIds: ReadonlySet<string>
): void {
  for (let index = turnContexts.length - 1; index >= 0; index -= 1) {
    const turnId = turnContexts[index]?.turnId;
    if (turnId && removedTurnIds.has(turnId)) turnContexts.splice(index, 1);
  }
}

function parseTurnContext(value: unknown): CodexTurnContext | null {
  const ctx = objectValue(value);
  if (!ctx) return null;
  return {
    turnId: nullableString(ctx.turn_id),
    model: nullableString(ctx.model),
    approvalPolicy: nullableString(ctx.approval_policy),
    sandboxPolicy: formatCodexPolicy(ctx.sandbox_policy),
    effort: nullableString(ctx.effort),
    serviceTier: nullableString(ctx.service_tier),
  };
}

function parseSessionMetaDynamicTools(value: unknown): CodexDynamicTool[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const tool = parseDynamicToolLike(item);
    return tool ? [tool] : [];
  });
}

function parseDynamicToolLike(value: unknown): CodexDynamicTool | null {
  const rec = objectValue(value);
  if (!rec) return null;
  const name = stringValue(rec.name);
  if (!name) return null;
  return {
    name,
    namespace: nullableString(rec.namespace),
    description: stringValue(rec.description) ?? '',
    inputSchema: stringValue(rec.input_schema) ?? stringValue(rec.inputSchema) ?? '',
    deferLoading:
      rec.defer_loading === 1 || rec.defer_loading === true || rec.deferLoading === true,
  };
}

function formatCodexPolicy(value: unknown): string | null {
  const str = nullableString(value);
  if (str) return str;
  const obj = objectValue(value);
  const type = nullableString(obj?.type);
  if (type) return type;
  return null;
}

function extractContentText(content: unknown): string | null {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return null;
  const parts: string[] = [];
  for (const block of content) {
    const obj = objectValue(block);
    if (!obj) continue;
    const text = nullableString(obj.text);
    if (text) parts.push(text);
  }
  return parts.length > 0 ? parts.join('\n') : null;
}

/**
 * Codex serializes several harness-generated inputs as `role: "user"` response
 * items. They are part of the model context, not messages the person sent from
 * Yoda, so they must stay out of prompt history and readable conversation rows.
 */
function isCodexInternalUserMessage(text: string): boolean {
  const trimmed = text.trimStart();
  return (
    trimmed.startsWith('# AGENTS.md instructions for ') ||
    trimmed.startsWith('<environment_context>') ||
    trimmed.includes('\n<environment_context>') ||
    trimmed.startsWith('<skill>') ||
    trimmed.startsWith('<recommended_plugins>') ||
    trimmed.startsWith('<turn_aborted>') ||
    trimmed.startsWith('Message from ') ||
    (trimmed.startsWith('You are "') &&
      trimmed.includes('one member of a team working together in this worktree.'))
  );
}

function emptyRollout(): ParsedCodexRollout {
  return {
    baseInstructions: null,
    developerMessages: [],
    prompts: [],
    compactions: [],
    messages: [],
    turnContexts: [],
    dynamicTools: [],
    completedTurnCount: 0,
    cliVersion: null,
    modelProvider: null,
    summary: null,
  };
}

function safeParse(line: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(line);
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : null;
  } catch (err) {
    log.debug('getCodexSessionContext: parse failed', { error: String(err) });
    return null;
  }
}

function withCodexState<T>(statePath: string, fn: (db: Database.Database) => T): T | undefined {
  if (!existsSync(statePath)) return undefined;
  const db = new Database(statePath, { readonly: true, fileMustExist: true });
  try {
    db.pragma('query_only = ON');
    return fn(db);
  } catch (error) {
    if (isExpectedUnavailableCodexStateError(error)) return undefined;
    throw error;
  } finally {
    db.close();
  }
}

function isExpectedUnavailableCodexStateError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return (
    error.message.includes('no such table: threads') ||
    error.message.includes('no such table: thread_dynamic_tools') ||
    error.message.includes('unable to open database file')
  );
}

function parseTimestampMs(value: string | null | undefined): number | undefined {
  if (!value) return undefined;
  const normalized = SQLITE_TIMESTAMP_RE.test(value) ? `${value.replace(' ', 'T')}Z` : value;
  const ms = Date.parse(normalized);
  return Number.isNaN(ms) ? undefined : ms;
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function nullableString(value: unknown): string | null {
  const str = stringValue(value)?.trim();
  return str ? str : null;
}

function nonNegativeInteger(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : 0;
}
