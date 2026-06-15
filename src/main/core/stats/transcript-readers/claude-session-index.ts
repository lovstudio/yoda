import { readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

// Claude transcripts are keyed by session id and outlive the cwd they ran
// under: an auto-merged worktree gets pruned, but `~/.claude/projects/<slug>/
// <sessionId>.jsonl` lingers under the now-gone worktree's slug. The slug
// derived from a task's current cwd then points at the wrong (or missing)
// directory, so usage for those sessions silently drops to zero. This index
// maps every recorded session id to the directory its transcript actually
// lives in, so resolution can fall back to it when the slug path misses.
//
// Filenames alone carry the session id, so building the index only lists
// directory entries — no file reads — across all project slug dirs.
const INDEX_TTL_MS = 60_000;

let index: Map<string, string> | null = null;
let builtAtMs = 0;
let building: Promise<Map<string, string>> | null = null;

async function buildIndex(): Promise<Map<string, string>> {
  const root = join(homedir(), '.claude', 'projects');
  const map = new Map<string, string>();
  let slugs: string[];
  try {
    slugs = await readdir(root);
  } catch {
    return map;
  }
  await Promise.all(
    slugs.map(async (slug) => {
      const dir = join(root, slug);
      let names: string[];
      try {
        names = await readdir(dir);
      } catch {
        return;
      }
      for (const name of names) {
        if (name.endsWith('.jsonl')) map.set(name.slice(0, -'.jsonl'.length), dir);
      }
    })
  );
  return map;
}

/**
 * Directory holding `<sessionId>.jsonl` across all `~/.claude/projects` slugs,
 * or null when no transcript with that id exists. Cached with a short TTL —
 * the full directory listing is cheap but not free at rollup scale.
 */
export async function findClaudeTranscriptDir(sessionId: string): Promise<string | null> {
  if (!index || Date.now() - builtAtMs > INDEX_TTL_MS) {
    building ??= buildIndex().then((map) => {
      index = map;
      builtAtMs = Date.now();
      building = null;
      return map;
    });
    await building;
  }
  return index?.get(sessionId) ?? null;
}
