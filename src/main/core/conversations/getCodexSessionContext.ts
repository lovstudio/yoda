import { existsSync, type Dirent } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import type {
  ClaudeSessionPrompt,
  CodexDynamicTool,
  CodexMemoryFile,
  CodexSessionContext,
  CodexTurnContext,
  SessionSummary,
  SessionTranscriptMessage,
} from '@shared/conversations';
import {
  findClosestCodexThreadRefByCreatedAt,
  findUniqueUntitledCodexThreadRefByCwdAfterCreatedAt,
  getClaimedCodexThreadId,
  resolveCodexStatePath,
} from '@main/core/session-title/codex-title-source';
import { log } from '@main/lib/logger';
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
  messages: SessionTranscriptMessage[];
  turnContexts: CodexTurnContext[];
  dynamicTools: CodexDynamicTool[];
  completedTurnCount: number;
  cliVersion: string | null;
  modelProvider: string | null;
  summary: SessionSummary | null;
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
const CODEX_CREATED_AT_MATCH_MAX_DISTANCE_MS = 2 * 60_000;
const SQLITE_TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

export async function getCodexSessionContext(
  cwd: string,
  conversationId: string,
  conversationTitle?: string,
  conversationCreatedAt?: string | null
): Promise<CodexSessionContext | null> {
  const codexHome = resolveCodexHome();
  const statePath = resolveCodexStatePath(codexHome);
  const thread =
    resolveCodexThread({
      statePath,
      cwd,
      conversationId,
      conversationTitle,
      conversationCreatedAt,
    }) ??
    (await resolveCodexThreadFromRollouts({
      codexHome,
      cwd,
      conversationId,
      conversationTitle,
      conversationCreatedAt,
    }));
  if (!thread) return null;

  const [rollout, memoryFiles, dbDynamicTools, skills] = await Promise.all([
    loadRollout(thread.rolloutPath),
    loadMemoryFiles(cwd),
    loadDynamicTools(statePath, thread.id),
    scanCodexSkills(cwd, { codexHome }),
  ]);

  const parsed = rollout ? parseCodexRollout(rollout, thread.firstUserMessage) : emptyRollout();
  const dynamicTools = dbDynamicTools.length > 0 ? dbDynamicTools : parsed.dynamicTools;

  return {
    threadId: thread.id,
    rolloutPath: thread.rolloutPath,
    title: thread.title,
    cwd: thread.cwd,
    model: thread.model,
    modelProvider: parsed.modelProvider ?? thread.modelProvider,
    cliVersion: parsed.cliVersion ?? thread.cliVersion,
    memoryMode: thread.memoryMode,
    approvalMode: thread.approvalMode,
    sandboxPolicy: thread.sandboxPolicy,
    baseInstructions: parsed.baseInstructions,
    developerMessages: parsed.developerMessages,
    memoryFiles,
    dynamicTools,
    skills,
    skillsListing: formatSkillListing(skills),
    prompts: parsed.prompts,
    messages: parsed.messages,
    turnContexts: parsed.turnContexts,
    completedTurnCount: parsed.completedTurnCount,
    summary: parsed.summary,
  };
}

export async function getCodexSessionModel(
  cwd: string,
  conversationId: string,
  conversationTitle?: string,
  conversationCreatedAt?: string | null
): Promise<string | null> {
  const codexHome = resolveCodexHome();
  const statePath = resolveCodexStatePath(codexHome);
  const thread =
    resolveCodexThread({
      statePath,
      cwd,
      conversationId,
      conversationTitle,
      conversationCreatedAt,
    }) ??
    (await resolveCodexThreadFromRollouts({
      codexHome,
      cwd,
      conversationId,
      conversationTitle,
      conversationCreatedAt,
    }));
  return thread?.model?.trim() || null;
}

function resolveCodexHome(): string {
  return process.env.CODEX_HOME ?? join(homedir(), '.codex');
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
  let hasMultipleLaterCreatedAtRows = false;

  for (const rolloutPath of rolloutPaths) {
    let raw: string;
    try {
      raw = await readFile(rolloutPath, 'utf8');
    } catch {
      continue;
    }

    const meta = parseCodexRolloutMeta(raw);
    if (!meta || meta.cwd !== cwd) continue;

    const parsed = parseCodexRollout(raw, null);
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
    if (title && (row.title === title || row.firstUserMessage === title)) return row;

    const rowCreatedAtMs = parseTimestampMs(meta.timestamp);
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
}: {
  statePath: string;
  cwd: string;
  conversationId: string;
  conversationTitle?: string;
  conversationCreatedAt?: string | null;
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

async function loadRollout(path: string | null): Promise<string | null> {
  if (!path) return null;
  try {
    return await readFile(path, 'utf8');
  } catch {
    return null;
  }
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

function parseCodexRollout(raw: string, firstUserMessage: string | null): ParsedCodexRollout {
  let baseInstructions: string | null = null;
  let cliVersion: string | null = null;
  let modelProvider: string | null = null;
  let dynamicTools: CodexDynamicTool[] = [];
  const developerMessages: ClaudeSessionPrompt[] = [];
  const eventPrompts: ClaudeSessionPrompt[] = [];
  const responseUserPrompts: ClaudeSessionPrompt[] = [];
  const messages: SessionTranscriptMessage[] = [];
  const turnContexts: CodexTurnContext[] = [];
  let completedTurnCount = 0;
  // Keep only the latest compaction summary — later compactions supersede earlier ones.
  let summary: SessionSummary | null = null;

  for (const line of raw.split('\n')) {
    if (!line) continue;
    const parsed = safeParse(line);
    if (!parsed) continue;
    const timestamp = nullableString(parsed.timestamp);

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
      if (ctx) turnContexts.push(ctx);
      continue;
    }

    if (parsed.type === 'event_msg') {
      const payload = objectValue(parsed.payload);
      if (!payload) continue;
      if (payload.type === 'task_complete' || payload.type === 'turn_complete') {
        completedTurnCount += 1;
        const lastAgentMessage = nullableString(payload.last_agent_message);
        if (lastAgentMessage) {
          pushMessage(messages, {
            id: timestamp ?? `event-assistant-${messages.length}`,
            role: 'assistant',
            text: lastAgentMessage,
            timestamp,
          });
        }
        continue;
      }
      if (payload.type !== 'user_message') continue;
      const text = nullableString(payload.message)?.trim();
      if (text) {
        const prompt = {
          id: timestamp ?? `event-user-${eventPrompts.length}`,
          text,
          timestamp,
        };
        eventPrompts.push(prompt);
        pushMessage(messages, { ...prompt, role: 'user' });
      }
      continue;
    }

    if (parsed.type === 'response_item') {
      const payload = objectValue(parsed.payload);
      if (!payload || payload.type !== 'message') continue;
      const text = extractContentText(payload.content)?.trim();
      if (!text) continue;
      if (payload.role === 'developer') {
        developerMessages.push({
          id: timestamp ?? `developer-${developerMessages.length}`,
          text,
          timestamp,
        });
      } else if (payload.role === 'user' && text.startsWith(CODEX_SUMMARY_PREFIX)) {
        summary = { text, timestamp };
      } else if (payload.role === 'user' && !isCodexEnvironmentMessage(text)) {
        const prompt = {
          id: timestamp ?? `response-user-${responseUserPrompts.length}`,
          text,
          timestamp,
        };
        responseUserPrompts.push(prompt);
        pushMessage(messages, { ...prompt, role: 'user' });
      } else if (payload.role === 'assistant') {
        pushMessage(messages, {
          id: timestamp ?? `response-assistant-${messages.length}`,
          role: 'assistant',
          text,
          timestamp,
        });
      }
    }
  }

  const prompts =
    eventPrompts.length > 0
      ? eventPrompts
      : responseUserPrompts.length > 0
        ? responseUserPrompts
        : firstUserMessage
          ? [{ id: 'first-user-message', text: firstUserMessage, timestamp: null }]
          : [];

  return {
    baseInstructions,
    developerMessages,
    prompts,
    messages:
      messages.length > 0
        ? messages
        : prompts.map((prompt) => ({ ...prompt, role: 'user' as const })),
    turnContexts,
    dynamicTools,
    completedTurnCount,
    cliVersion,
    modelProvider,
    summary,
  };
}

function pushMessage(
  messages: SessionTranscriptMessage[],
  message: SessionTranscriptMessage
): void {
  const previous = messages[messages.length - 1];
  if (previous?.role === message.role && previous.text === message.text) return;
  messages.push(message);
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

function isCodexEnvironmentMessage(text: string): boolean {
  return (
    text.startsWith('# AGENTS.md instructions for ') ||
    text.startsWith('<environment_context>') ||
    text.includes('\n<environment_context>')
  );
}

function emptyRollout(): ParsedCodexRollout {
  return {
    baseInstructions: null,
    developerMessages: [],
    prompts: [],
    messages: [],
    turnContexts: [],
    dynamicTools: [],
    completedTurnCount: 0,
    cliVersion: null,
    modelProvider: null,
    summary: null,
  };
}

async function loadMemoryFiles(cwd: string): Promise<CodexMemoryFile[]> {
  const candidates: {
    kind: CodexMemoryFile['kind'];
    path: string;
  }[] = [
    { kind: 'global-codex-agents', path: join(homedir(), '.codex', 'AGENTS.md') },
    { kind: 'project-agents', path: join(cwd, 'AGENTS.md') },
    { kind: 'project-codex-agents', path: join(cwd, '.codex', 'AGENTS.md') },
  ];

  const out = await Promise.all(
    candidates.map(async ({ kind, path }) => {
      try {
        const content = await readFile(path, 'utf8');
        return { kind, path, content, bytes: content.length };
      } catch {
        return null;
      }
    })
  );
  return out.filter((x): x is CodexMemoryFile => x !== null);
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
