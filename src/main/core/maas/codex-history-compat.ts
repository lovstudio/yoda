import { closeSync, existsSync, fsyncSync, openSync, readFileSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { parse as parseToml } from 'smol-toml';
import type { RuntimeCustomConfig } from '@shared/app-settings';
import { resolveCodexStatePath } from '@main/core/session-title/codex-title-source';
import { resolveRuntimeStateDirectory } from '../conversations/impl/runtime-env';

const LEGACY_PROVIDER_ID = 'yoda-maas';
const NATIVE_PROVIDER_ID = 'openai';
const CODEX_STATE_BUSY_TIMEOUT_MS = 5_000;

type CodexThreadProviderRow = {
  id: string;
  rolloutPath: string;
  modelProvider: string;
};

type SessionMeta = {
  type: 'session_meta';
  timestamp?: unknown;
  payload: Record<string, unknown>;
};

export type CodexMaasHistoryMigrationResult = {
  rows: number;
  files: number;
  failed?: true;
};

export type CodexResumeProviderCompatibilityResult =
  | { status: 'unchanged'; providerId?: string }
  | { status: 'repaired'; fromProviderId: string; toProviderId: string }
  | {
      status: 'failed';
      fromProviderId?: string;
      toProviderId?: string;
      reason: string;
    };

/**
 * One-time compatibility migration for threads created by the previous MaaS
 * launcher. OpenCodex's Design B keeps routed threads on the native `openai`
 * provider; mirror that outcome so Codex App can index and resume them.
 */
export function migrateLegacyCodexMaasHistory({
  statePath = resolveCodexStatePath(),
}: {
  statePath?: string;
} = {}): CodexMaasHistoryMigrationResult {
  if (!existsSync(statePath)) return { rows: 0, files: 0 };

  const legacyRows = readThreadRowsByProvider(statePath, LEGACY_PROVIDER_ID);
  if (!legacyRows) return { rows: 0, files: 0, failed: true };
  if (legacyRows.length === 0) return { rows: 0, files: 0 };

  const compatibleRows: CodexThreadProviderRow[] = [];
  let files = 0;
  let failed = false;
  for (const row of legacyRows) {
    if (!row.rolloutPath || !existsSync(row.rolloutPath)) {
      compatibleRows.push(row);
      continue;
    }
    try {
      if (migrateRolloutProvider(row.rolloutPath, row.id, LEGACY_PROVIDER_ID, NATIVE_PROVIDER_ID)) {
        compatibleRows.push(row);
        files += 1;
      } else {
        failed = true;
      }
    } catch {
      failed = true;
    }
  }

  if (compatibleRows.length === 0) {
    return { rows: 0, files, ...(failed ? { failed: true as const } : {}) };
  }

  let db: Database.Database | undefined;
  try {
    db = new Database(statePath, { fileMustExist: true });
    db.pragma(`busy_timeout = ${CODEX_STATE_BUSY_TIMEOUT_MS}`);
    const update = db.prepare(
      'UPDATE threads SET model_provider = ? WHERE id = ? AND model_provider = ?'
    );
    const migrateRows = db.transaction((rows: CodexThreadProviderRow[]) =>
      rows.reduce(
        (count, row) => count + update.run(NATIVE_PROVIDER_ID, row.id, LEGACY_PROVIDER_ID).changes,
        0
      )
    );
    const rows = migrateRows(compatibleRows);
    return { rows, files, ...(failed ? { failed: true as const } : {}) };
  } catch {
    return { rows: 0, files, failed: true };
  } finally {
    db?.close();
  }
}

export function migrateLegacyCodexMaasHistoryForConfig(
  providerConfig: RuntimeCustomConfig | undefined
): CodexMaasHistoryMigrationResult {
  const codexHome = resolveRuntimeStateDirectory('codex', providerConfig);
  return migrateLegacyCodexMaasHistory({ statePath: resolveCodexStatePath(codexHome) });
}

/**
 * Codex persists the model provider in each thread. If Yoda switches MaaS
 * providers or returns to the native account, an older thread can reference a
 * provider table that no longer exists in config.toml. Codex then exits during
 * TUI bootstrap before the user can continue.
 *
 * Repair only the requested thread, and only when its historical provider is
 * unavailable. The replacement is the currently active, available provider.
 */
export function ensureCodexResumeProviderCompatibleForConfig(
  threadId: string,
  providerConfig: RuntimeCustomConfig | undefined,
  invocationProviderId?: string
): CodexResumeProviderCompatibilityResult {
  const codexHome = resolveRuntimeStateDirectory('codex', providerConfig);
  return ensureCodexResumeProviderCompatible({
    threadId,
    statePath: resolveCodexStatePath(codexHome),
    configPath: join(codexHome, 'config.toml'),
    invocationProviderId,
  });
}

export function ensureCodexResumeProviderCompatible({
  threadId,
  statePath,
  configPath,
  invocationProviderId,
}: {
  threadId: string;
  statePath: string;
  configPath: string;
  invocationProviderId?: string;
}): CodexResumeProviderCompatibilityResult {
  if (!existsSync(statePath)) return { status: 'unchanged' };

  const row = readThreadProviderRow(statePath, threadId);
  if (!row) return { status: 'unchanged' };

  const configured = readConfiguredProviders(configPath, invocationProviderId);
  if (!configured) {
    return {
      status: 'failed',
      fromProviderId: row.modelProvider,
      reason: 'Codex config could not be parsed.',
    };
  }
  if (configured.availableProviderIds.has(row.modelProvider)) {
    return { status: 'unchanged', providerId: row.modelProvider };
  }

  const targetProviderId = configured.activeProviderId;
  if (!configured.availableProviderIds.has(targetProviderId)) {
    return {
      status: 'failed',
      fromProviderId: row.modelProvider,
      toProviderId: targetProviderId,
      reason: 'The active Codex model provider is unavailable.',
    };
  }
  if (!row.rolloutPath || !existsSync(row.rolloutPath)) {
    return {
      status: 'failed',
      fromProviderId: row.modelProvider,
      toProviderId: targetProviderId,
      reason: 'The Codex rollout file is missing.',
    };
  }

  try {
    if (!migrateRolloutProvider(row.rolloutPath, row.id, row.modelProvider, targetProviderId)) {
      return {
        status: 'failed',
        fromProviderId: row.modelProvider,
        toProviderId: targetProviderId,
        reason: 'The Codex rollout metadata could not be updated safely.',
      };
    }

    const db = new Database(statePath, { fileMustExist: true });
    try {
      db.pragma(`busy_timeout = ${CODEX_STATE_BUSY_TIMEOUT_MS}`);
      const changes = db
        .prepare('UPDATE threads SET model_provider = ? WHERE id = ? AND model_provider = ?')
        .run(targetProviderId, row.id, row.modelProvider).changes;
      if (changes !== 1) {
        const current = db
          .prepare('SELECT model_provider AS modelProvider FROM threads WHERE id = ? LIMIT 1')
          .get(row.id) as { modelProvider?: unknown } | undefined;
        if (current?.modelProvider !== targetProviderId) {
          return {
            status: 'failed',
            fromProviderId: row.modelProvider,
            toProviderId: targetProviderId,
            reason: 'The Codex thread index changed during provider repair.',
          };
        }
      }
    } finally {
      db.close();
    }
  } catch {
    return {
      status: 'failed',
      fromProviderId: row.modelProvider,
      toProviderId: targetProviderId,
      reason: 'The Codex thread provider repair failed.',
    };
  }

  return {
    status: 'repaired',
    fromProviderId: row.modelProvider,
    toProviderId: targetProviderId,
  };
}

function readConfiguredProviders(
  configPath: string,
  invocationProviderId?: string
): { activeProviderId: string; availableProviderIds: Set<string> } | undefined {
  if (!existsSync(configPath)) {
    return {
      activeProviderId: invocationProviderId ?? NATIVE_PROVIDER_ID,
      availableProviderIds: new Set([
        NATIVE_PROVIDER_ID,
        ...(invocationProviderId ? [invocationProviderId] : []),
      ]),
    };
  }
  try {
    const parsed = parseToml(readFileSync(configPath, 'utf8')) as Record<string, unknown>;
    const activeProviderId =
      invocationProviderId ??
      (typeof parsed.model_provider === 'string' && parsed.model_provider.trim()
        ? parsed.model_provider.trim()
        : NATIVE_PROVIDER_ID);
    const availableProviderIds = new Set([NATIVE_PROVIDER_ID]);
    if (invocationProviderId) availableProviderIds.add(invocationProviderId);
    if (parsed.model_providers && typeof parsed.model_providers === 'object') {
      for (const providerId of Object.keys(parsed.model_providers)) {
        availableProviderIds.add(providerId);
      }
    }
    return { activeProviderId, availableProviderIds };
  } catch {
    return undefined;
  }
}

function readThreadRowsByProvider(
  statePath: string,
  providerId: string
): CodexThreadProviderRow[] | undefined {
  let db: Database.Database | undefined;
  try {
    db = new Database(statePath, { readonly: true, fileMustExist: true });
    db.pragma('query_only = ON');
    db.pragma(`busy_timeout = ${CODEX_STATE_BUSY_TIMEOUT_MS}`);
    const rows = db
      .prepare(
        'SELECT id, rollout_path AS rolloutPath, model_provider AS modelProvider FROM threads WHERE model_provider = ?'
      )
      .all(providerId);
    return rows.flatMap((row) => {
      if (!row || typeof row !== 'object') return [];
      const record = row as Record<string, unknown>;
      return typeof record.id === 'string' &&
        typeof record.rolloutPath === 'string' &&
        typeof record.modelProvider === 'string'
        ? [
            {
              id: record.id,
              rolloutPath: record.rolloutPath,
              modelProvider: record.modelProvider,
            },
          ]
        : [];
    });
  } catch {
    return undefined;
  } finally {
    db?.close();
  }
}

function readThreadProviderRow(
  statePath: string,
  threadId: string
): CodexThreadProviderRow | undefined {
  let db: Database.Database | undefined;
  try {
    db = new Database(statePath, { readonly: true, fileMustExist: true });
    db.pragma('query_only = ON');
    db.pragma(`busy_timeout = ${CODEX_STATE_BUSY_TIMEOUT_MS}`);
    const row = db
      .prepare(
        'SELECT id, rollout_path AS rolloutPath, model_provider AS modelProvider FROM threads WHERE id = ? LIMIT 1'
      )
      .get(threadId);
    if (!row || typeof row !== 'object') return undefined;
    const record = row as Record<string, unknown>;
    if (
      typeof record.id !== 'string' ||
      typeof record.rolloutPath !== 'string' ||
      typeof record.modelProvider !== 'string'
    ) {
      return undefined;
    }
    return {
      id: record.id,
      rolloutPath: record.rolloutPath,
      modelProvider: record.modelProvider,
    };
  } catch {
    return undefined;
  } finally {
    db?.close();
  }
}

function migrateRolloutProvider(
  path: string,
  expectedId: string,
  fromProviderId: string,
  toProviderId: string
): boolean {
  const content = readFileSync(path, 'utf8');
  const lines = content.split('\n');
  const latest = findLatestSessionMeta(lines);
  if (!latest || latest.payload.id !== expectedId) return false;
  if (
    latest.payload.model_provider !== fromProviderId &&
    latest.payload.model_provider !== toProviderId
  ) {
    return false;
  }

  const firstLine = lines[0];
  if (
    !firstLine ||
    !patchFirstLineProvider(path, firstLine, expectedId, fromProviderId, toProviderId)
  ) {
    return false;
  }
  if (latest.payload.model_provider === toProviderId) return true;

  latest.payload.model_provider = toProviderId;
  latest.timestamp = new Date().toISOString();
  appendRolloutLine(path, JSON.stringify(latest));
  return true;
}

function findLatestSessionMeta(lines: string[]): SessionMeta | undefined {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const parsed = parseSessionMeta(lines[index]);
    if (parsed) return parsed;
  }
  return undefined;
}

function parseSessionMeta(line: string | undefined): SessionMeta | undefined {
  if (!line?.includes('session_meta')) return undefined;
  try {
    const parsed = JSON.parse(line) as unknown;
    if (!parsed || typeof parsed !== 'object') return undefined;
    const record = parsed as Record<string, unknown>;
    if (record.type !== 'session_meta' || !record.payload || typeof record.payload !== 'object') {
      return undefined;
    }
    return record as SessionMeta;
  } catch {
    return undefined;
  }
}

function patchFirstLineProvider(
  path: string,
  firstLine: string,
  expectedId: string,
  fromProviderId: string,
  toProviderId: string
): boolean {
  const firstMeta = parseSessionMeta(firstLine);
  if (!firstMeta || firstMeta.payload.id !== expectedId) return false;
  if (firstMeta.payload.model_provider === toProviderId) return true;
  if (firstMeta.payload.model_provider !== fromProviderId) return false;

  const encodedFromProvider = JSON.stringify(fromProviderId);
  const providerPattern = new RegExp(
    `("model_provider"\\s*:\\s*)${escapeRegExp(encodedFromProvider)}`
  );
  const match = firstLine.match(providerPattern);
  if (!match || match.index === undefined) return false;
  const replacementCore = `${match[1]}${JSON.stringify(toProviderId)}`;
  const paddingBytes =
    Buffer.byteLength(match[0], 'utf8') - Buffer.byteLength(replacementCore, 'utf8');
  if (paddingBytes < 0) return false;
  const replacement = `${replacementCore}${' '.repeat(paddingBytes)}`;
  const patched =
    firstLine.slice(0, match.index) + replacement + firstLine.slice(match.index + match[0].length);
  if (Buffer.byteLength(patched, 'utf8') !== Buffer.byteLength(firstLine, 'utf8')) return false;
  if (parseSessionMeta(patched)?.payload.model_provider !== toProviderId) return false;

  const fd = openSync(path, 'r+');
  try {
    writeBuffer(fd, Buffer.from(patched, 'utf8'), 0);
    try {
      fsyncSync(fd);
    } catch {
      // Best-effort durability; the fixed-length write is already complete.
    }
  } finally {
    closeSync(fd);
  }
  return true;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function appendRolloutLine(path: string, line: string): void {
  const fd = openSync(path, 'a');
  try {
    writeBuffer(fd, Buffer.from(line.endsWith('\n') ? line : `${line}\n`, 'utf8'), null);
    try {
      fsyncSync(fd);
    } catch {
      // Best-effort durability; O_APPEND keeps the record atomic for this writer.
    }
  } finally {
    closeSync(fd);
  }
}

function writeBuffer(fd: number, buffer: Buffer, position: number | null): void {
  let offset = 0;
  while (offset < buffer.length) {
    const written = writeSync(
      fd,
      buffer,
      offset,
      buffer.length - offset,
      position === null ? null : position + offset
    );
    if (written <= 0) throw new Error('Failed to write Codex rollout metadata.');
    offset += written;
  }
}
