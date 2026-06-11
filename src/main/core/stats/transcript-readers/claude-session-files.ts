import { readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { encodeClaudeProjectDir } from '@main/core/session-title/claude-title-source';

/**
 * All transcript files for one Claude session: the main transcript plus
 * subagent (Task tool) transcripts under `<projectDir>/<sessionId>/subagents/`.
 */
export async function listClaudeSessionTranscriptPaths(
  projectDir: string,
  sessionId: string
): Promise<string[]> {
  const paths = [join(projectDir, `${sessionId}.jsonl`)];
  const subagentsDir = join(projectDir, sessionId, 'subagents');
  try {
    const names = await readdir(subagentsDir);
    paths.push(
      ...names
        .filter((name) => name.endsWith('.jsonl'))
        .sort()
        .map((name) => join(subagentsDir, name))
    );
  } catch {
    // No subagents directory — the common case.
  }
  return paths;
}

export type ClaudeDirectorySession = { sessionId: string; paths: string[] };

/**
 * Every Claude session recorded for a working directory, resolved through
 * the `~/.claude/projects/<encoded-cwd>` layout. Works for directories that
 * no longer exist on disk — transcripts outlive the cwd they were run in.
 */
export async function listClaudeSessionsForDirectory(
  cwd: string
): Promise<ClaudeDirectorySession[]> {
  const projectDir = join(homedir(), '.claude', 'projects', encodeClaudeProjectDir(cwd));
  let names: string[];
  try {
    names = await readdir(projectDir);
  } catch {
    return [];
  }
  return Promise.all(
    names
      .filter((name) => name.endsWith('.jsonl'))
      .sort()
      .map(async (name) => {
        const sessionId = name.slice(0, -'.jsonl'.length);
        return { sessionId, paths: await listClaudeSessionTranscriptPaths(projectDir, sessionId) };
      })
  );
}
