import { closeSync, existsSync, fstatSync, openSync, readSync } from 'node:fs';
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

function toNonNegativeSafeInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}
