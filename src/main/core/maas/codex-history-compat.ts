import { closeSync, existsSync, fsyncSync, openSync, readFileSync, writeSync } from 'node:fs';
import Database from 'better-sqlite3';
import type { RuntimeCustomConfig } from '@shared/app-settings';
import { resolveCodexStatePath } from '@main/core/session-title/codex-title-source';
import { resolveRuntimeStateDirectory } from '../conversations/impl/runtime-env';

const LEGACY_PROVIDER_ID = 'yoda-maas';
const NATIVE_PROVIDER_ID = 'openai';
const CODEX_STATE_BUSY_TIMEOUT_MS = 5_000;

type LegacyThreadRow = {
  id: string;
  rolloutPath: string;
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

  const legacyRows = readLegacyThreadRows(statePath);
  if (!legacyRows) return { rows: 0, files: 0, failed: true };
  if (legacyRows.length === 0) return { rows: 0, files: 0 };

  const compatibleRows: LegacyThreadRow[] = [];
  let files = 0;
  let failed = false;
  for (const row of legacyRows) {
    if (!row.rolloutPath || !existsSync(row.rolloutPath)) {
      compatibleRows.push(row);
      continue;
    }
    try {
      if (migrateRolloutProvider(row.rolloutPath, row.id)) {
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
    const migrateRows = db.transaction((rows: LegacyThreadRow[]) =>
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

function readLegacyThreadRows(statePath: string): LegacyThreadRow[] | undefined {
  let db: Database.Database | undefined;
  try {
    db = new Database(statePath, { readonly: true, fileMustExist: true });
    db.pragma('query_only = ON');
    db.pragma(`busy_timeout = ${CODEX_STATE_BUSY_TIMEOUT_MS}`);
    const rows = db
      .prepare('SELECT id, rollout_path AS rolloutPath FROM threads WHERE model_provider = ?')
      .all(LEGACY_PROVIDER_ID);
    return rows.flatMap((row) => {
      if (!row || typeof row !== 'object') return [];
      const record = row as Record<string, unknown>;
      return typeof record.id === 'string' && typeof record.rolloutPath === 'string'
        ? [{ id: record.id, rolloutPath: record.rolloutPath }]
        : [];
    });
  } catch {
    return undefined;
  } finally {
    db?.close();
  }
}

function migrateRolloutProvider(path: string, expectedId: string): boolean {
  const content = readFileSync(path, 'utf8');
  const lines = content.split('\n');
  const latest = findLatestSessionMeta(lines);
  if (!latest || latest.payload.id !== expectedId) return false;
  if (
    latest.payload.model_provider !== LEGACY_PROVIDER_ID &&
    latest.payload.model_provider !== NATIVE_PROVIDER_ID
  ) {
    return false;
  }

  const firstLine = lines[0];
  if (!firstLine || !patchFirstLineProvider(path, firstLine, expectedId)) return false;
  if (latest.payload.model_provider === NATIVE_PROVIDER_ID) return true;

  latest.payload.model_provider = NATIVE_PROVIDER_ID;
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

function patchFirstLineProvider(path: string, firstLine: string, expectedId: string): boolean {
  const firstMeta = parseSessionMeta(firstLine);
  if (!firstMeta || firstMeta.payload.id !== expectedId) return false;
  if (firstMeta.payload.model_provider === NATIVE_PROVIDER_ID) return true;
  if (firstMeta.payload.model_provider !== LEGACY_PROVIDER_ID) return false;

  const match = firstLine.match(/("model_provider"\s*:\s*)"yoda-maas"/);
  if (!match || match.index === undefined) return false;
  const replacementCore = `${match[1]}"${NATIVE_PROVIDER_ID}"`;
  const paddingBytes =
    Buffer.byteLength(match[0], 'utf8') - Buffer.byteLength(replacementCore, 'utf8');
  if (paddingBytes < 0) return false;
  const replacement = `${replacementCore}${' '.repeat(paddingBytes)}`;
  const patched =
    firstLine.slice(0, match.index) + replacement + firstLine.slice(match.index + match[0].length);
  if (Buffer.byteLength(patched, 'utf8') !== Buffer.byteLength(firstLine, 'utf8')) return false;
  if (parseSessionMeta(patched)?.payload.model_provider !== NATIVE_PROVIDER_ID) return false;

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
