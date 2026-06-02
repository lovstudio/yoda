import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import type {
  ClaudeSessionPrompt,
  CodexDynamicTool,
  CodexMemoryFile,
  CodexSessionContext,
  CodexTurnContext,
} from '@shared/conversations';
import {
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
  turnContexts: CodexTurnContext[];
  cliVersion: string | null;
  modelProvider: string | null;
};

export async function getCodexSessionContext(
  cwd: string,
  conversationId: string,
  conversationTitle?: string
): Promise<CodexSessionContext | null> {
  const statePath = resolveCodexStatePath();
  const thread = resolveCodexThread({
    statePath,
    cwd,
    conversationId,
    conversationTitle,
  });
  if (!thread) return null;

  const [rollout, memoryFiles, dynamicTools, skillsListing] = await Promise.all([
    loadRollout(thread.rolloutPath),
    loadMemoryFiles(cwd),
    loadDynamicTools(statePath, thread.id),
    scanCodexSkills(cwd),
  ]);

  const parsed = rollout ? parseCodexRollout(rollout, thread.firstUserMessage) : emptyRollout();

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
    skillsListing,
    prompts: parsed.prompts,
    turnContexts: parsed.turnContexts,
  };
}

function resolveCodexThread({
  statePath,
  cwd,
  conversationId,
  conversationTitle,
}: {
  statePath: string;
  cwd: string;
  conversationId: string;
  conversationTitle?: string;
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
  const developerMessages: ClaudeSessionPrompt[] = [];
  const eventPrompts: ClaudeSessionPrompt[] = [];
  const responseUserPrompts: ClaudeSessionPrompt[] = [];
  const turnContexts: CodexTurnContext[] = [];

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
      continue;
    }

    if (parsed.type === 'turn_context') {
      const ctx = parseTurnContext(parsed.payload);
      if (ctx) turnContexts.push(ctx);
      continue;
    }

    if (parsed.type === 'event_msg') {
      const payload = objectValue(parsed.payload);
      if (!payload || payload.type !== 'user_message') continue;
      const text = nullableString(payload.message)?.trim();
      if (text) {
        eventPrompts.push({
          id: timestamp ?? `event-user-${eventPrompts.length}`,
          text,
          timestamp,
        });
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
      } else if (payload.role === 'user' && !isCodexEnvironmentMessage(text)) {
        responseUserPrompts.push({
          id: timestamp ?? `response-user-${responseUserPrompts.length}`,
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
    turnContexts,
    cliVersion,
    modelProvider,
  };
}

function parseTurnContext(value: unknown): CodexTurnContext | null {
  const ctx = objectValue(value);
  if (!ctx) return null;
  return {
    turnId: nullableString(ctx.turn_id),
    model: nullableString(ctx.model),
    approvalPolicy: nullableString(ctx.approval_policy),
    sandboxPolicy: nullableString(ctx.sandbox_policy),
    effort: nullableString(ctx.effort),
  };
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
    turnContexts: [],
    cliVersion: null,
    modelProvider: null,
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
