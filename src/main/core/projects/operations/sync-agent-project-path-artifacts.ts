import { existsSync } from 'node:fs';
import { lstat, mkdir, readdir, rename, rmdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import Database from 'better-sqlite3';
import { encodeClaudeProjectDir } from '@main/core/session-title/claude-title-source';
import { resolveCodexStatePath } from '@main/core/session-title/codex-title-source';
import { log } from '@main/lib/logger';

export type ClaudeProjectArtifactSyncResult = {
  status: 'same' | 'missing' | 'renamed' | 'merged';
  movedEntries: number;
  skippedEntries: number;
  sourceDir: string;
  targetDir: string;
};

export type CodexProjectArtifactSyncResult = {
  updatedThreads: number;
  statePath: string;
};

export type SyncAgentProjectPathArtifactsResult = {
  claude: ClaudeProjectArtifactSyncResult;
  codex: CodexProjectArtifactSyncResult;
};

type SyncAgentProjectPathArtifactsOptions = {
  claudeProjectsDir?: string;
  codexStatePath?: string;
};

export async function syncAgentProjectPathArtifacts(
  oldPath: string,
  newPath: string,
  options: SyncAgentProjectPathArtifactsOptions = {}
): Promise<SyncAgentProjectPathArtifactsResult> {
  const claudeProjectsDir = options.claudeProjectsDir ?? join(homedir(), '.claude', 'projects');
  const codexStatePath = options.codexStatePath ?? resolveCodexStatePath();

  const [claude, codex] = await Promise.all([
    syncWithLog(
      'Claude project artifacts',
      () => syncClaudeProjectArtifacts(oldPath, newPath, claudeProjectsDir),
      () => defaultClaudeResult(oldPath, newPath, claudeProjectsDir)
    ),
    syncWithLog(
      'Codex project artifacts',
      () => syncCodexProjectArtifacts(oldPath, newPath, codexStatePath),
      () => ({ updatedThreads: 0, statePath: codexStatePath })
    ),
  ]);

  return { claude, codex };
}

export async function syncClaudeProjectArtifacts(
  oldPath: string,
  newPath: string,
  claudeProjectsDir = join(homedir(), '.claude', 'projects')
): Promise<ClaudeProjectArtifactSyncResult> {
  const sourceDir = join(claudeProjectsDir, encodeClaudeProjectDir(oldPath));
  const targetDir = join(claudeProjectsDir, encodeClaudeProjectDir(newPath));

  if (sourceDir === targetDir) {
    return { status: 'same', movedEntries: 0, skippedEntries: 0, sourceDir, targetDir };
  }

  if (!(await isDirectory(sourceDir))) {
    return { status: 'missing', movedEntries: 0, skippedEntries: 0, sourceDir, targetDir };
  }

  if (!(await pathExists(targetDir))) {
    await mkdir(dirname(targetDir), { recursive: true });
    await rename(sourceDir, targetDir);
    return { status: 'renamed', movedEntries: 1, skippedEntries: 0, sourceDir, targetDir };
  }

  if (!(await isDirectory(targetDir))) {
    return { status: 'merged', movedEntries: 0, skippedEntries: 1, sourceDir, targetDir };
  }

  const result = await moveDirectoryContents(sourceDir, targetDir);
  await removeDirectoryIfEmpty(sourceDir);
  return {
    status: 'merged',
    movedEntries: result.movedEntries,
    skippedEntries: result.skippedEntries,
    sourceDir,
    targetDir,
  };
}

export function syncCodexProjectArtifacts(
  oldPath: string,
  newPath: string,
  statePath = resolveCodexStatePath()
): CodexProjectArtifactSyncResult {
  const normalizedOldPath = trimTrailingSeparators(oldPath);
  const normalizedNewPath = trimTrailingSeparators(newPath);
  if (normalizedOldPath === normalizedNewPath || !existsSync(statePath)) {
    return { updatedThreads: 0, statePath };
  }

  const db = new Database(statePath, { fileMustExist: true });
  try {
    db.pragma('busy_timeout = 1000');
    const table = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'threads'")
      .get();
    if (!table) return { updatedThreads: 0, statePath };
    const oldPathPrefix = `${normalizedOldPath}/`;
    const result = db
      .prepare(
        `
          UPDATE threads
          SET cwd = ? || substr(cwd, ?)
          WHERE cwd = ?
            OR substr(cwd, 1, ?) = ?
        `
      )
      .run(
        normalizedNewPath,
        normalizedOldPath.length + 1,
        normalizedOldPath,
        oldPathPrefix.length,
        oldPathPrefix
      );
    return { updatedThreads: result.changes, statePath };
  } catch (error) {
    if (isMissingCodexStateShape(error)) return { updatedThreads: 0, statePath };
    throw error;
  } finally {
    db.close();
  }
}

function trimTrailingSeparators(value: string): string {
  let out = value.trim();
  while (out.length > 1 && out.endsWith('/')) {
    out = out.slice(0, -1);
  }
  return out;
}

async function syncWithLog<T>(label: string, run: () => Promise<T> | T, fallback: () => T) {
  try {
    return await run();
  } catch (error) {
    log.warn(`syncAgentProjectPathArtifacts: failed to sync ${label}`, {
      error: error instanceof Error ? error.message : String(error),
    });
    return fallback();
  }
}

function defaultClaudeResult(
  oldPath: string,
  newPath: string,
  claudeProjectsDir: string
): ClaudeProjectArtifactSyncResult {
  return {
    status: 'missing',
    movedEntries: 0,
    skippedEntries: 0,
    sourceDir: join(claudeProjectsDir, encodeClaudeProjectDir(oldPath)),
    targetDir: join(claudeProjectsDir, encodeClaudeProjectDir(newPath)),
  };
}

async function moveDirectoryContents(
  sourceDir: string,
  targetDir: string
): Promise<{ movedEntries: number; skippedEntries: number }> {
  await mkdir(targetDir, { recursive: true });
  let movedEntries = 0;
  let skippedEntries = 0;

  const entries = await readdir(sourceDir, { withFileTypes: true });
  for (const entry of entries) {
    const sourcePath = join(sourceDir, entry.name);
    const targetPath = join(targetDir, entry.name);
    const targetExists = await pathExists(targetPath);

    if (!targetExists) {
      await rename(sourcePath, targetPath);
      movedEntries += 1;
      continue;
    }

    if (entry.isDirectory() && (await isDirectory(targetPath))) {
      const result = await moveDirectoryContents(sourcePath, targetPath);
      movedEntries += result.movedEntries;
      skippedEntries += result.skippedEntries;
      await removeDirectoryIfEmpty(sourcePath);
      continue;
    }

    skippedEntries += 1;
  }

  return { movedEntries, skippedEntries };
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch {
    return false;
  }
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await lstat(path)).isDirectory();
  } catch {
    return false;
  }
}

async function removeDirectoryIfEmpty(path: string): Promise<void> {
  try {
    await rmdir(path);
  } catch (error) {
    if (isExpectedDirectoryNotEmptyError(error)) return;
    throw error;
  }
}

function isExpectedDirectoryNotEmptyError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error.code === 'ENOTEMPTY' || error.code === 'EEXIST' || error.code === 'ENOENT')
  );
}

function isMissingCodexStateShape(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return (
    error.message.includes('no such table: threads') || error.message.includes('no such column')
  );
}
