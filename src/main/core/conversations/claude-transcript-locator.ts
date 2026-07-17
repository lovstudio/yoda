import { readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Locates a Claude transcript by session id alone, without knowing the cwd it
 * was spawned in.
 *
 * The canonical path is ~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl, but
 * on-demand callers may not have mounted the task yet and cannot resolve the cwd:
 * the task is not provisioned after an app restart, so the in-memory task
 * manager has no entry for it. Session ids are UUIDs — globally unique — so a
 * one-shot scan of the projects directory is an unambiguous lookup.
 *
 * The index is memoized briefly so a cold load over hundreds of conversations
 * walks the directory tree once, not once per conversation.
 */
const INDEX_TTL_MS = 30_000;

let cached: { at: number; index: Promise<Map<string, string>> } | null = null;

export async function findClaudeTranscriptPathBySessionId(
  sessionId: string
): Promise<string | undefined> {
  const now = Date.now();
  if (!cached || now - cached.at >= INDEX_TTL_MS) {
    cached = { at: now, index: buildIndex() };
  }
  return (await cached.index).get(sessionId);
}

/** sessionId -> absolute transcript path. Best-effort: unreadable dirs are skipped. */
async function buildIndex(): Promise<Map<string, string>> {
  const index = new Map<string, string>();
  const root = join(homedir(), '.claude', 'projects');
  let projectDirs: string[];
  try {
    projectDirs = (await readdir(root, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return index;
  }
  await Promise.all(
    projectDirs.map(async (dir) => {
      try {
        for (const file of await readdir(join(root, dir))) {
          if (file.endsWith('.jsonl')) {
            index.set(file.slice(0, -'.jsonl'.length), join(root, dir, file));
          }
        }
      } catch {
        // Skip unreadable project dirs.
      }
    })
  );
  return index;
}
