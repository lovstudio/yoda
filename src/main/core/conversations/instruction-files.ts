import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type {
  ClaudeMemoryFile,
  CodexMemoryFile,
  RuntimeInstructionFile,
} from '@shared/conversations';
import { getRuntime, type RuntimeId } from '@shared/runtime-registry';

/**
 * Loads the human-authored instruction files that feed the Claude prompt:
 * the user-global ~/.claude/CLAUDE.md plus the project's CLAUDE.md / AGENTS.md.
 * Works pre-session — pass no cwd (e.g. SSH projects) to get the global file only.
 */
export async function getInstructionFiles(cwd?: string | null): Promise<ClaudeMemoryFile[]> {
  const candidates: { kind: ClaudeMemoryFile['kind']; path: string }[] = [
    { kind: 'global-claude', path: join(homedir(), '.claude', 'CLAUDE.md') },
  ];
  if (cwd) {
    candidates.push(
      { kind: 'project-claude', path: join(cwd, 'CLAUDE.md') },
      { kind: 'project-agents', path: join(cwd, 'AGENTS.md') }
    );
  }

  const out = await Promise.all(
    candidates.map(async ({ kind, path }): Promise<ClaudeMemoryFile | null> => {
      try {
        const content = await readFile(path, 'utf8');
        return { kind, path, content, bytes: content.length };
      } catch {
        return null;
      }
    })
  );
  return out.filter((x): x is ClaudeMemoryFile => x !== null);
}

export async function getCodexInstructionFiles(cwd?: string | null): Promise<CodexMemoryFile[]> {
  const candidates: { kind: CodexMemoryFile['kind']; path: string }[] = [
    { kind: 'global-codex-agents', path: join(homedir(), '.codex', 'AGENTS.md') },
  ];
  if (cwd) {
    candidates.push(
      { kind: 'project-agents', path: join(cwd, 'AGENTS.md') },
      { kind: 'project-codex-agents', path: join(cwd, '.codex', 'AGENTS.md') }
    );
  }

  const out = await Promise.all(
    candidates.map(async ({ kind, path }): Promise<CodexMemoryFile | null> => {
      try {
        const content = await readFile(path, 'utf8');
        return { kind, path, content, bytes: content.length };
      } catch {
        return null;
      }
    })
  );
  return out.filter((x): x is CodexMemoryFile => x !== null);
}

export async function getRuntimeInstructionFiles({
  runtimeId,
  cwd,
}: {
  runtimeId?: RuntimeId | null;
  cwd?: string | null;
}): Promise<RuntimeInstructionFile[]> {
  const cli = runtimeId ? getRuntime(runtimeId)?.cli : null;
  if (cli === 'codex') return getCodexInstructionFiles(cwd);
  if (cli === 'claude') return getInstructionFiles(cwd);
  return [];
}
