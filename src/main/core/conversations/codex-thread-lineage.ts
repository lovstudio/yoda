import { closeSync, openSync, readSync } from 'node:fs';
import Database from 'better-sqlite3';

type CodexLineageThreadRow = {
  id: string;
  rolloutPath: string;
  createdAtMs: number;
  updatedAtMs: number;
};

const FIRST_LINE_CHUNK_BYTES = 256 * 1024;
const MAX_FIRST_LINE_BYTES = 2 * 1024 * 1024;

/**
 * Codex turns an in-TUI rewind into a new thread whose rollout declares
 * `forked_from_id`. Yoda still owns one conversation in that case, so reads and
 * resumes must follow the newest reachable fork instead of staying on the
 * original thread.
 *
 * Provider forks that Yoda persisted as separate conversations are reserved by
 * their thread ids. They are deliberately excluded so sibling Yoda sessions do
 * not collapse back into their parent.
 */
export function resolveLatestCodexThreadIdInLineage({
  statePath,
  rootThreadId,
  reservedThreadIds = new Set<string>(),
}: {
  statePath: string;
  rootThreadId: string;
  reservedThreadIds?: ReadonlySet<string>;
}): string {
  let db: Database.Database;
  try {
    db = new Database(statePath, { readonly: true, fileMustExist: true });
  } catch {
    return rootThreadId;
  }

  try {
    db.pragma('query_only = ON');
    const root = readLineageRoot(db, rootThreadId);
    if (!root) return rootThreadId;

    const candidates = readLineageCandidates(db, root);
    const reachable = new Set<string>([rootThreadId]);
    const reachableRows = new Map<string, CodexLineageThreadRow>([[rootThreadId, root]]);
    const pending = candidates.filter((candidate) => candidate.id !== rootThreadId);

    let added = true;
    while (added) {
      added = false;
      for (let index = pending.length - 1; index >= 0; index -= 1) {
        const candidate = pending[index];
        if (!candidate || reservedThreadIds.has(candidate.id)) {
          pending.splice(index, 1);
          continue;
        }
        const parentThreadId = readForkedFromThreadId(candidate);
        if (!parentThreadId || !reachable.has(parentThreadId)) continue;
        reachable.add(candidate.id);
        reachableRows.set(candidate.id, candidate);
        pending.splice(index, 1);
        added = true;
      }
    }

    return (
      Array.from(reachableRows.values()).sort(
        (a, b) =>
          b.updatedAtMs - a.updatedAtMs || b.createdAtMs - a.createdAtMs || b.id.localeCompare(a.id)
      )[0]?.id ?? rootThreadId
    );
  } catch {
    return rootThreadId;
  } finally {
    db.close();
  }
}

function readLineageRoot(
  db: Database.Database,
  rootThreadId: string
): (CodexLineageThreadRow & { title: string; firstUserMessage: string }) | null {
  const row = db
    .prepare(
      `
        SELECT
          id,
          NULLIF(rollout_path, '') AS rolloutPath,
          title,
          first_user_message AS firstUserMessage,
          COALESCE(created_at_ms, created_at * 1000) AS createdAtMs,
          COALESCE(updated_at_ms, updated_at * 1000) AS updatedAtMs
        FROM threads
        WHERE id = ?
        LIMIT 1
      `
    )
    .get(rootThreadId);
  if (!row || typeof row !== 'object') return null;
  const record = row as Record<string, unknown>;
  if (
    typeof record.id !== 'string' ||
    typeof record.rolloutPath !== 'string' ||
    typeof record.title !== 'string' ||
    typeof record.firstUserMessage !== 'string' ||
    typeof record.createdAtMs !== 'number' ||
    typeof record.updatedAtMs !== 'number'
  ) {
    return null;
  }
  return {
    id: record.id,
    rolloutPath: record.rolloutPath,
    title: record.title,
    firstUserMessage: record.firstUserMessage,
    createdAtMs: record.createdAtMs,
    updatedAtMs: record.updatedAtMs,
  };
}

function readLineageCandidates(
  db: Database.Database,
  root: CodexLineageThreadRow & { title: string; firstUserMessage: string }
): CodexLineageThreadRow[] {
  if (!root.title.trim() && !root.firstUserMessage.trim()) return [root];
  const rows = db
    .prepare(
      `
        SELECT
          id,
          NULLIF(rollout_path, '') AS rolloutPath,
          COALESCE(created_at_ms, created_at * 1000) AS createdAtMs,
          COALESCE(updated_at_ms, updated_at * 1000) AS updatedAtMs
        FROM threads
        WHERE NULLIF(rollout_path, '') IS NOT NULL
          AND COALESCE(created_at_ms, created_at * 1000) >= ?
          AND (
            (? <> '' AND first_user_message = ?)
            OR (? <> '' AND title = ?)
          )
        ORDER BY COALESCE(created_at_ms, created_at * 1000) ASC, id ASC
      `
    )
    .all(root.createdAtMs, root.firstUserMessage, root.firstUserMessage, root.title, root.title);
  if (!Array.isArray(rows)) return [root];
  return rows.flatMap((row) => {
    if (!row || typeof row !== 'object') return [];
    const record = row as Record<string, unknown>;
    if (
      typeof record.id !== 'string' ||
      typeof record.rolloutPath !== 'string' ||
      typeof record.createdAtMs !== 'number' ||
      typeof record.updatedAtMs !== 'number'
    ) {
      return [];
    }
    return [
      {
        id: record.id,
        rolloutPath: record.rolloutPath,
        createdAtMs: record.createdAtMs,
        updatedAtMs: record.updatedAtMs,
      },
    ];
  });
}

function readForkedFromThreadId(candidate: CodexLineageThreadRow): string | null {
  const firstLine = readFirstLine(candidate.rolloutPath);
  if (!firstLine) return null;
  try {
    const row = JSON.parse(firstLine) as unknown;
    if (!row || typeof row !== 'object') return null;
    const record = row as Record<string, unknown>;
    if (record.type !== 'session_meta') return null;
    const payload = record.payload;
    if (!payload || typeof payload !== 'object') return null;
    const payloadRecord = payload as Record<string, unknown>;
    if (payloadRecord.id !== candidate.id) return null;
    const parentThreadId = payloadRecord.forked_from_id;
    return typeof parentThreadId === 'string' && parentThreadId.trim()
      ? parentThreadId.trim()
      : null;
  } catch {
    return null;
  }
}

function readFirstLine(path: string): string | null {
  let fd: number;
  try {
    fd = openSync(path, 'r');
  } catch {
    return null;
  }

  try {
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    while (totalBytes < MAX_FIRST_LINE_BYTES) {
      const chunk = Buffer.allocUnsafe(
        Math.min(FIRST_LINE_CHUNK_BYTES, MAX_FIRST_LINE_BYTES - totalBytes)
      );
      const bytesRead = readSync(fd, chunk, 0, chunk.length, totalBytes);
      if (bytesRead === 0) break;
      const data = chunk.subarray(0, bytesRead);
      const newline = data.indexOf(0x0a);
      chunks.push(newline === -1 ? data : data.subarray(0, newline));
      totalBytes += bytesRead;
      if (newline !== -1) return Buffer.concat(chunks).toString('utf8');
    }
    return chunks.length > 0 && totalBytes < MAX_FIRST_LINE_BYTES
      ? Buffer.concat(chunks).toString('utf8')
      : null;
  } finally {
    closeSync(fd);
  }
}
