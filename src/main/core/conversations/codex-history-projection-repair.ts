import {
  closeSync,
  existsSync,
  fstatSync,
  fsyncSync,
  openSync,
  readSync,
  writeSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import Database from 'better-sqlite3';

const CODEX_THREAD_HISTORY_DB = 'thread_history_1.sqlite';
const MAX_CHECKPOINT_LINE_BYTES = 512 * 1024;
const SQLITE_BUSY_TIMEOUT_MS = 1_000;

type CodexThreadRow = {
  historyMode: unknown;
  rolloutPath: unknown;
};

type ProjectionCheckpointRow = {
  nextRolloutByteOffset: unknown;
  nextRolloutOrdinal: unknown;
};

export type CodexHistoryProjectionRepairResult =
  | {
      status: 'repaired';
      byteOffset: number;
      fromOrdinal: number;
      toOrdinal: number;
    }
  | {
      status: 'unchanged';
      reason:
        | 'checkpoint-changed'
        | 'checkpoint-current'
        | 'history-unavailable'
        | 'not-paginated'
        | 'unsupported-regression';
    }
  | { status: 'failed'; reason: string };

export type CodexDuplicateSessionMetaRepairResult =
  | { status: 'repaired'; fromHistoryMode: 'paginated'; toHistoryMode: 'legacy' }
  | {
      status: 'unchanged';
      reason: 'history-unavailable' | 'no-duplicate-boundary' | 'not-paginated';
    }
  | { status: 'failed'; reason: string };

/**
 * Older Yoda builds repaired a stale provider by appending a copy of the
 * thread's SessionMeta. Codex treats any later SessionMeta as the start of a
 * newer rollout segment, so reverse model-context replay stops there even
 * though the renderer can still read every message from the JSONL file.
 *
 * Preserve the rollout bytes and switch only affected threads to Codex's
 * full-file legacy replay. This repairs existing conversations without
 * invalidating byte offsets or fork references in the transcript.
 */
export function repairCodexDuplicatedSessionMetaBoundary({
  statePath,
  threadId,
}: {
  statePath: string;
  threadId: string;
}): CodexDuplicateSessionMetaRepairResult {
  const thread = readPaginatedThread(statePath, threadId);
  if (thread === 'not-paginated') return { status: 'unchanged', reason: 'not-paginated' };
  if (!thread || !existsSync(thread.rolloutPath)) {
    return { status: 'unchanged', reason: 'history-unavailable' };
  }

  try {
    const historyPath = join(dirname(statePath), CODEX_THREAD_HISTORY_DB);
    const checkpointOffset = readProjectionCheckpointOffset(historyPath, threadId);
    const firstLine = readCompleteLineAtOffset(thread.rolloutPath, 0);
    const firstMeta = parseSessionMeta(firstLine);
    if (
      !firstLine ||
      checkpointOffset === undefined ||
      !firstMeta ||
      firstMeta.payload.id !== threadId
    ) {
      return { status: 'unchanged', reason: 'history-unavailable' };
    }

    const candidate = parseSessionMeta(
      readCompleteLineAtOffset(thread.rolloutPath, checkpointOffset)
    );
    const hasDuplicateBoundary =
      candidate?.ordinal === 0 &&
      candidate.payload.id === threadId &&
      sessionMetaPayloadsMatch(firstMeta.payload, candidate.payload);
    if (!hasDuplicateBoundary) {
      return { status: 'unchanged', reason: 'no-duplicate-boundary' };
    }

    const patchedFirstLine = patchHistoryModeInPlace(firstLine);
    if (!patchedFirstLine) {
      return { status: 'failed', reason: 'The canonical SessionMeta could not be patched safely.' };
    }
    if (patchedFirstLine !== firstLine) {
      const fd = openSync(thread.rolloutPath, 'r+');
      try {
        writeBuffer(fd, Buffer.from(patchedFirstLine, 'utf8'), 0);
        try {
          fsyncSync(fd);
        } catch {
          // Best-effort durability; the fixed-length write is already complete.
        }
      } finally {
        closeSync(fd);
      }
    }

    const db = new Database(statePath, { fileMustExist: true });
    try {
      db.pragma(`busy_timeout = ${SQLITE_BUSY_TIMEOUT_MS}`);
      const changes = db
        .prepare(
          "UPDATE threads SET history_mode = 'legacy' WHERE id = ? AND history_mode = 'paginated'"
        )
        .run(threadId).changes;
      if (changes !== 1) {
        return { status: 'failed', reason: 'The Codex thread history mode changed concurrently.' };
      }
    } finally {
      db.close();
    }

    return { status: 'repaired', fromHistoryMode: 'paginated', toHistoryMode: 'legacy' };
  } catch (error) {
    return { status: 'failed', reason: String(error) };
  }
}

function readProjectionCheckpointOffset(historyPath: string, threadId: string): number | undefined {
  if (!existsSync(historyPath)) return undefined;
  let db: Database.Database | undefined;
  try {
    db = new Database(historyPath, { readonly: true, fileMustExist: true });
    db.pragma('query_only = ON');
    db.pragma(`busy_timeout = ${SQLITE_BUSY_TIMEOUT_MS}`);
    const row = db
      .prepare(
        `
          SELECT next_rollout_byte_offset AS nextRolloutByteOffset
          FROM thread_history_projection_state
          WHERE thread_id = ?
          LIMIT 1
        `
      )
      .get(threadId) as { nextRolloutByteOffset?: unknown } | undefined;
    return toNonNegativeSafeInteger(row?.nextRolloutByteOffset);
  } catch {
    return undefined;
  } finally {
    db?.close();
  }
}

/**
 * Codex 0.147 can persist `thread_settings_applied` with the previous rollout
 * ordinal after an interrupted turn. Its paginated projection has already
 * consumed that ordinal, so every later resume stops at the duplicate and the
 * TUI reconstructs only the prefix before it.
 *
 * This repairs the projection cursor, not the rollout. The duplicated event is
 * metadata-only, so allowing the projector to consume it again preserves every
 * transcript record and lets Codex advance normally on the next resume.
 */
export function repairCodexThreadHistoryProjection({
  statePath,
  threadId,
}: {
  statePath: string;
  threadId: string;
}): CodexHistoryProjectionRepairResult {
  const thread = readPaginatedThread(statePath, threadId);
  if (thread === 'not-paginated') return { status: 'unchanged', reason: 'not-paginated' };
  if (!thread) return { status: 'unchanged', reason: 'history-unavailable' };

  const historyPath = join(dirname(statePath), CODEX_THREAD_HISTORY_DB);
  if (!existsSync(historyPath) || !existsSync(thread.rolloutPath)) {
    return { status: 'unchanged', reason: 'history-unavailable' };
  }

  let historyDb: Database.Database | undefined;
  try {
    historyDb = new Database(historyPath, { fileMustExist: true });
    historyDb.pragma(`busy_timeout = ${SQLITE_BUSY_TIMEOUT_MS}`);
    const checkpoint = historyDb
      .prepare(
        `
          SELECT
            next_rollout_byte_offset AS nextRolloutByteOffset,
            next_rollout_ordinal AS nextRolloutOrdinal
          FROM thread_history_projection_state
          WHERE thread_id = ?
          LIMIT 1
        `
      )
      .get(threadId) as ProjectionCheckpointRow | undefined;
    const byteOffset = toNonNegativeSafeInteger(checkpoint?.nextRolloutByteOffset);
    const expectedOrdinal = toNonNegativeSafeInteger(checkpoint?.nextRolloutOrdinal);
    if (byteOffset === undefined || expectedOrdinal === undefined) {
      return { status: 'unchanged', reason: 'history-unavailable' };
    }

    const checkpointLine = readCompleteLineAtOffset(thread.rolloutPath, byteOffset);
    if (!checkpointLine) return { status: 'unchanged', reason: 'history-unavailable' };

    const event = parseRolloutEvent(checkpointLine);
    if (!event) return { status: 'unchanged', reason: 'history-unavailable' };
    if (event.ordinal >= expectedOrdinal) {
      return { status: 'unchanged', reason: 'checkpoint-current' };
    }
    if (
      event.ordinal !== expectedOrdinal - 1 ||
      event.type !== 'event_msg' ||
      event.payloadType !== 'thread_settings_applied'
    ) {
      return { status: 'unchanged', reason: 'unsupported-regression' };
    }

    const changes = historyDb
      .prepare(
        `
          UPDATE thread_history_projection_state
          SET next_rollout_ordinal = ?
          WHERE thread_id = ?
            AND next_rollout_byte_offset = ?
            AND next_rollout_ordinal = ?
        `
      )
      .run(event.ordinal, threadId, byteOffset, expectedOrdinal).changes;
    if (changes !== 1) return { status: 'unchanged', reason: 'checkpoint-changed' };

    return {
      status: 'repaired',
      byteOffset,
      fromOrdinal: expectedOrdinal,
      toOrdinal: event.ordinal,
    };
  } catch (error) {
    return { status: 'failed', reason: String(error) };
  } finally {
    historyDb?.close();
  }
}

function readPaginatedThread(
  statePath: string,
  threadId: string
): { rolloutPath: string } | 'not-paginated' | undefined {
  if (!existsSync(statePath)) return undefined;
  let stateDb: Database.Database | undefined;
  try {
    stateDb = new Database(statePath, { readonly: true, fileMustExist: true });
    stateDb.pragma('query_only = ON');
    const row = stateDb
      .prepare(
        `
          SELECT
            history_mode AS historyMode,
            NULLIF(rollout_path, '') AS rolloutPath
          FROM threads
          WHERE id = ?
          LIMIT 1
        `
      )
      .get(threadId) as CodexThreadRow | undefined;
    if (!row) return undefined;
    if (row.historyMode !== 'paginated') return 'not-paginated';
    return typeof row.rolloutPath === 'string' && row.rolloutPath.length > 0
      ? { rolloutPath: row.rolloutPath }
      : undefined;
  } catch {
    return undefined;
  } finally {
    stateDb?.close();
  }
}

function readCompleteLineAtOffset(path: string, byteOffset: number): string | undefined {
  let fd: number | undefined;
  try {
    fd = openSync(path, 'r');
    const size = fstatSync(fd).size;
    if (byteOffset < 0 || byteOffset >= size) return undefined;
    if (byteOffset > 0) {
      const previous = Buffer.allocUnsafe(1);
      if (readSync(fd, previous, 0, 1, byteOffset - 1) !== 1 || previous[0] !== 0x0a) {
        return undefined;
      }
    }

    const buffer = Buffer.allocUnsafe(Math.min(MAX_CHECKPOINT_LINE_BYTES, size - byteOffset));
    const bytesRead = readSync(fd, buffer, 0, buffer.length, byteOffset);
    const newlineIndex = buffer.subarray(0, bytesRead).indexOf(0x0a);
    if (newlineIndex < 0) return undefined;
    const line = buffer.subarray(0, newlineIndex).toString('utf8');
    return line.endsWith('\r') ? line.slice(0, -1) : line;
  } catch {
    return undefined;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

function parseRolloutEvent(
  line: string
): { ordinal: number; type: unknown; payloadType: unknown } | undefined {
  try {
    const value = JSON.parse(line) as Record<string, unknown>;
    const ordinal = toNonNegativeSafeInteger(value.ordinal);
    if (ordinal === undefined) return undefined;
    const payload =
      value.payload && typeof value.payload === 'object'
        ? (value.payload as Record<string, unknown>)
        : undefined;
    return { ordinal, type: value.type, payloadType: payload?.type };
  } catch {
    return undefined;
  }
}

type SessionMetaRecord = {
  ordinal?: unknown;
  type: 'session_meta';
  payload: Record<string, unknown>;
};

function parseSessionMeta(line: string | undefined): SessionMetaRecord | undefined {
  if (!line?.includes('session_meta')) return undefined;
  try {
    const value = JSON.parse(line) as Record<string, unknown>;
    if (value.type !== 'session_meta' || !value.payload || typeof value.payload !== 'object') {
      return undefined;
    }
    return value as SessionMetaRecord;
  } catch {
    return undefined;
  }
}

function patchHistoryModeInPlace(firstLine: string): string | undefined {
  const current = parseSessionMeta(firstLine)?.payload.history_mode;
  if (current === 'legacy') return firstLine;
  const pattern = /("history_mode"\s*:\s*)"paginated"/;
  const match = firstLine.match(pattern);
  if (!match || match.index === undefined) return undefined;
  const replacementCore = `${match[1]}"legacy"`;
  const paddingBytes =
    Buffer.byteLength(match[0], 'utf8') - Buffer.byteLength(replacementCore, 'utf8');
  if (paddingBytes < 0) return undefined;
  const replacement = `${replacementCore}${' '.repeat(paddingBytes)}`;
  const patched =
    firstLine.slice(0, match.index) + replacement + firstLine.slice(match.index + match[0].length);
  if (Buffer.byteLength(patched, 'utf8') !== Buffer.byteLength(firstLine, 'utf8')) return undefined;
  return parseSessionMeta(patched)?.payload.history_mode === 'legacy' ? patched : undefined;
}

function sessionMetaPayloadsMatch(
  first: Record<string, unknown>,
  candidate: Record<string, unknown>
): boolean {
  const normalize = (payload: Record<string, unknown>): string => {
    const comparable = { ...payload };
    delete comparable.history_mode;
    return JSON.stringify(comparable);
  };
  return normalize(first) === normalize(candidate);
}

function writeBuffer(fd: number, buffer: Buffer, position: number): void {
  let offset = 0;
  while (offset < buffer.length) {
    const written = writeSync(fd, buffer, offset, buffer.length - offset, position + offset);
    if (written <= 0) throw new Error('Failed to write Codex rollout metadata.');
    offset += written;
  }
}

function toNonNegativeSafeInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}
