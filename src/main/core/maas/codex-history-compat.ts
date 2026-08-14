import { randomUUID } from 'node:crypto';
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  writeFileSync,
  writeSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import Database from 'better-sqlite3';
import { parse as parseToml } from 'smol-toml';
import type { RuntimeCustomConfig } from '@shared/app-settings';
import { resolveCodexStatePath } from '@main/core/session-title/codex-title-source';
import { resolveRuntimeStateDirectory } from '../conversations/impl/runtime-env';
import { CODEX_SHARED_PROVIDER_ID, LEGACY_CODEX_SHARED_PROVIDER_IDS } from './codex-maas-provider';

const LEGACY_PROVIDER_ID = 'yoda-maas';
const NATIVE_PROVIDER_ID = 'openai';
const CODEX_STATE_BUSY_TIMEOUT_MS = 5_000;
const LEGACY_YODA_PROVIDER_IDS = new Set([
  LEGACY_PROVIDER_ID,
  NATIVE_PROVIDER_ID,
  ...LEGACY_CODEX_SHARED_PROVIDER_IDS,
  'zenmux',
  'openrouter',
  'siliconflow',
  'litellm',
  'newapi',
  'cliproxyapi',
]);
const LEGACY_PROFILE_PROVIDER_PATTERN =
  /^(?:zenmux|openrouter|siliconflow|litellm|newapi|cliproxyapi|custom)-[a-f0-9]{12}$/;

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
  backupPath?: string;
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
 * Move native OpenAI sessions and every provider id previously emitted by Yoda
 * into one shared Codex history bucket. Provider metadata is patched in place
 * and padded when the target id is shorter, so paginated rollout offsets remain
 * valid.
 */
export function migrateLegacyCodexMaasHistory({
  statePath = resolveCodexStatePath(),
  includeNativeProvider = false,
}: {
  statePath?: string;
  includeNativeProvider?: boolean;
} = {}): CodexMaasHistoryMigrationResult {
  if (!existsSync(statePath)) return { rows: 0, files: 0 };

  const legacyRows = readThreadRowsForSharedProvider(statePath, includeNativeProvider);
  if (!legacyRows) return { rows: 0, files: 0, failed: true };
  if (legacyRows.length === 0) return { rows: 0, files: 0 };

  let backup: CodexHistoryMigrationBackup;
  try {
    backup = createHistoryMigrationBackup(statePath, legacyRows);
  } catch {
    return { rows: 0, files: 0, failed: true };
  }

  const compatibleRows: CodexThreadProviderRow[] = [];
  let files = 0;
  let failed = false;
  for (const row of legacyRows) {
    if (!row.rolloutPath || !existsSync(row.rolloutPath)) {
      compatibleRows.push(row);
      continue;
    }
    try {
      const rolloutProviderId = readRolloutProviderId(row.rolloutPath, row.id);
      if (
        !rolloutProviderId ||
        (rolloutProviderId !== CODEX_SHARED_PROVIDER_ID &&
          !isLegacyYodaProviderId(rolloutProviderId, true))
      ) {
        failed = true;
        continue;
      }
      if (
        migrateRolloutProvider(row.rolloutPath, row.id, rolloutProviderId, CODEX_SHARED_PROVIDER_ID)
      ) {
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
    return {
      rows: 0,
      files,
      backupPath: backup.root,
      ...(failed ? { failed: true as const } : {}),
    };
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
        (count, row) =>
          count + update.run(CODEX_SHARED_PROVIDER_ID, row.id, row.modelProvider).changes,
        0
      )
    );
    const rows = migrateRows(compatibleRows);
    return {
      rows,
      files,
      backupPath: backup.root,
      ...(failed || rows !== compatibleRows.length ? { failed: true as const } : {}),
    };
  } catch {
    restoreHistoryMigrationBackup(backup);
    return { rows: 0, files: 0, backupPath: backup.root, failed: true };
  } finally {
    db?.close();
  }
}

export function migrateLegacyCodexMaasHistoryForConfig(
  providerConfig: RuntimeCustomConfig | undefined,
  options?: { includeNativeProvider?: boolean }
): CodexMaasHistoryMigrationResult {
  const codexHome = resolveRuntimeStateDirectory('codex', providerConfig);
  return migrateLegacyCodexMaasHistory({
    statePath: resolveCodexStatePath(codexHome),
    includeNativeProvider: options?.includeNativeProvider,
  });
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

function readThreadRowsForSharedProvider(
  statePath: string,
  includeNativeProvider: boolean
): CodexThreadProviderRow[] | undefined {
  let db: Database.Database | undefined;
  try {
    db = new Database(statePath, { readonly: true, fileMustExist: true });
    db.pragma('query_only = ON');
    db.pragma(`busy_timeout = ${CODEX_STATE_BUSY_TIMEOUT_MS}`);
    const rows = db
      .prepare(
        'SELECT id, rollout_path AS rolloutPath, model_provider AS modelProvider FROM threads WHERE model_provider != ?'
      )
      .all(CODEX_SHARED_PROVIDER_ID);
    return rows.flatMap((row) => {
      if (!row || typeof row !== 'object') return [];
      const record = row as Record<string, unknown>;
      return typeof record.id === 'string' &&
        typeof record.rolloutPath === 'string' &&
        typeof record.modelProvider === 'string'
        ? isLegacyYodaProviderId(record.modelProvider, includeNativeProvider)
          ? [
              {
                id: record.id,
                rolloutPath: record.rolloutPath,
                modelProvider: record.modelProvider,
              },
            ]
          : []
        : [];
    });
  } catch {
    return undefined;
  } finally {
    db?.close();
  }
}

function isLegacyYodaProviderId(providerId: string, includeNativeProvider: boolean): boolean {
  if (providerId === NATIVE_PROVIDER_ID) return includeNativeProvider;
  return (
    LEGACY_YODA_PROVIDER_IDS.has(providerId) || LEGACY_PROFILE_PROVIDER_PATTERN.test(providerId)
  );
}

type CodexHistoryMigrationBackup = {
  root: string;
  rows: CodexThreadProviderRow[];
};

function createHistoryMigrationBackup(
  statePath: string,
  rows: CodexThreadProviderRow[]
): CodexHistoryMigrationBackup {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const root = join(
    dirname(statePath),
    'yoda-backups',
    'codex-unified-history-v1',
    `${timestamp}-${randomUUID()}`
  );
  mkdirSync(root, { recursive: true, mode: 0o700 });
  writeFileSync(
    join(root, 'manifest.json'),
    `${JSON.stringify(
      {
        version: 1,
        createdAt: new Date().toISOString(),
        statePath,
        targetProviderId: CODEX_SHARED_PROVIDER_ID,
        threads: rows.map((row) => ({
          id: row.id,
          rolloutPath: row.rolloutPath,
          sourceProviderId: row.modelProvider,
        })),
      },
      null,
      2
    )}\n`,
    { encoding: 'utf8', mode: 0o600 }
  );
  return { root, rows };
}

function restoreHistoryMigrationBackup(backup: CodexHistoryMigrationBackup): void {
  for (const row of backup.rows) {
    if (!row.rolloutPath || !existsSync(row.rolloutPath)) continue;
    try {
      migrateRolloutProvider(row.rolloutPath, row.id, CODEX_SHARED_PROVIDER_ID, row.modelProvider);
    } catch {
      // The manifest remains available for a later recovery attempt.
    }
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
  const firstLine = lines[0];
  if (!firstLine) return false;
  const firstMeta = parseSessionMeta(firstLine);
  if (!firstMeta || firstMeta.payload.id !== expectedId) return false;
  if (
    firstMeta.payload.model_provider !== fromProviderId &&
    firstMeta.payload.model_provider !== toProviderId
  ) {
    return false;
  }

  return patchRolloutProvidersInPlace(path, lines, expectedId, fromProviderId, toProviderId);
}

function readRolloutProviderId(path: string, expectedId: string): string | undefined {
  const firstLine = readFileSync(path, 'utf8').split('\n', 1)[0];
  const firstMeta = parseSessionMeta(firstLine);
  if (!firstMeta || firstMeta.payload.id !== expectedId) return undefined;
  return typeof firstMeta.payload.model_provider === 'string'
    ? firstMeta.payload.model_provider
    : undefined;
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

/**
 * Keep every JSONL record at the same byte offset. Codex's paginated history
 * stores byte cursors in thread_history_1.sqlite, so appending a replacement
 * SessionMeta creates a new history boundary and makes model-context replay
 * stop before the original conversation.
 */
function patchRolloutProvidersInPlace(
  path: string,
  lines: string[],
  expectedId: string,
  fromProviderId: string,
  toProviderId: string
): boolean {
  const encodedFromProvider = JSON.stringify(fromProviderId);
  const providerPattern = new RegExp(
    `("model_provider"\\s*:\\s*)${escapeRegExp(encodedFromProvider)}\\s*`
  );
  const patches: Array<{ offset: number; line: string }> = [];
  let byteOffset = 0;
  for (const line of lines) {
    const meta = parseSessionMeta(line);
    if (meta?.payload.id === expectedId && meta.payload.model_provider === fromProviderId) {
      const match = line.match(providerPattern);
      if (!match || match.index === undefined) return false;
      const replacementCore = `${match[1]}${JSON.stringify(toProviderId)}`;
      const paddingBytes =
        Buffer.byteLength(match[0], 'utf8') - Buffer.byteLength(replacementCore, 'utf8');
      if (paddingBytes < 0) return false;
      const replacement = `${replacementCore}${' '.repeat(paddingBytes)}`;
      const patched =
        line.slice(0, match.index) + replacement + line.slice(match.index + match[0].length);
      if (Buffer.byteLength(patched, 'utf8') !== Buffer.byteLength(line, 'utf8')) return false;
      if (parseSessionMeta(patched)?.payload.model_provider !== toProviderId) return false;
      patches.push({ offset: byteOffset, line: patched });
    }
    byteOffset += Buffer.byteLength(line, 'utf8') + 1;
  }

  const firstProvider = parseSessionMeta(lines[0])?.payload.model_provider;
  if (firstProvider === fromProviderId && patches.length === 0) return false;
  if (patches.length === 0) return firstProvider === toProviderId;

  const fd = openSync(path, 'r+');
  try {
    for (const patch of patches) {
      writeBuffer(fd, Buffer.from(patch.line, 'utf8'), patch.offset);
    }
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
