import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import type { RuntimeCustomConfig } from '@shared/app-settings';
import { log } from '@main/lib/logger';
import { resolveRuntimeStateDirectory } from './impl/runtime-env';

export type SessionStateRuntimeId = 'claude' | 'codex';

export type StoredSessionStateRoots = Partial<Record<SessionStateRuntimeId, string[]>>;

export interface SessionStateRootsStorage {
  read(): Promise<StoredSessionStateRoots>;
  write(value: StoredSessionStateRoots): Promise<void>;
}

export class SessionStateRootsCatalog {
  constructor(private readonly storage: SessionStateRootsStorage) {}

  async list(
    runtimeId: SessionStateRuntimeId,
    providerConfig: RuntimeCustomConfig | undefined,
    options: { home?: string; processEnv?: NodeJS.ProcessEnv } = {}
  ): Promise<string[]> {
    const home = options.home ?? homedir();
    const defaultRoot = join(home, runtimeId === 'codex' ? '.codex' : '.claude');
    const currentRoot = resolveRuntimeStateDirectory(runtimeId, providerConfig, {
      home,
      processEnv: options.processEnv,
    });
    const stored: StoredSessionStateRoots = await this.storage.read().catch(() => ({}));
    const seedRoots = normalizeRoots([defaultRoot, currentRoot, ...(stored[runtimeId] ?? [])]);
    const profileRoots = (
      await Promise.all(seedRoots.map((root) => discoverProfileRoots(runtimeId, root)))
    ).flat();
    const roots = normalizeRoots([...seedRoots, ...profileRoots]);

    const nextStored = { ...stored, [runtimeId]: roots };
    if (!sameStringArray(stored[runtimeId] ?? [], roots)) {
      await this.storage.write(nextStored).catch((error) => {
        log.warn('SessionStateRootsCatalog: failed to remember state roots', {
          runtimeId,
          error: String(error),
        });
      });
    }
    return roots;
  }
}

export function withRuntimeStateRoot(
  runtimeId: SessionStateRuntimeId,
  providerConfig: RuntimeCustomConfig | undefined,
  stateRoot: string
): RuntimeCustomConfig {
  const envName = runtimeId === 'codex' ? 'CODEX_HOME' : 'CLAUDE_CONFIG_DIR';
  return {
    ...providerConfig,
    env: {
      ...providerConfig?.env,
      [envName]: stateRoot,
    },
  };
}

export function parseStoredSessionStateRoots(value: unknown): StoredSessionStateRoots {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const record = value as Record<string, unknown>;
  const parsed: StoredSessionStateRoots = {};
  for (const runtimeId of ['claude', 'codex'] as const) {
    const roots = record[runtimeId];
    if (!Array.isArray(roots)) continue;
    parsed[runtimeId] = roots.filter((item): item is string => typeof item === 'string');
  }
  return parsed;
}

async function discoverProfileRoots(
  runtimeId: SessionStateRuntimeId,
  root: string
): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }

  return entries.flatMap((entry) => {
    if (!entry.isDirectory()) return [];
    const candidate = join(root, entry.name);
    if (runtimeId === 'codex') {
      return existsSync(join(candidate, 'state_5.sqlite')) ||
        existsSync(join(candidate, 'sessions'))
        ? [candidate]
        : [];
    }
    return existsSync(join(candidate, 'projects')) ? [candidate] : [];
  });
}

function normalizeRoots(values: string[]): string[] {
  const roots: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed) continue;
    const normalized = resolve(trimmed);
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    roots.push(normalized);
  }
  return roots;
}

function sameStringArray(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
