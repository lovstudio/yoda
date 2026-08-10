import type { RuntimeId } from './runtime-registry';
import { createHash } from './utils';

export type Terminal = {
  id: string;
  projectId: string;
  taskId: string;
  ssh?: boolean;
  name: string;
};

export type CreateTerminalParams = {
  id: string;
  projectId: string;
  taskId: string;
  name: string;
  initialSize?: { cols: number; rows: number };
  /** Start a one-shot command process instead of an interactive shell. */
  command?: string;
  /** Workspace terminals may opt out of persistence for one-shot commands. */
  persist?: boolean;
};

export const GLOBAL_TERMINAL_PROJECT_ID = 'workspace';
export const GLOBAL_TERMINAL_SCOPE_ID = 'global';

export function projectTerminalScopeId(kind: 'local' | 'ssh', projectId: string): string {
  return `${kind}:${projectId}:project-view`;
}

function stableTerminalIdentityHash(value: string): string {
  const hashes = [0x811c9dc5, 0x9e3779b9, 0x85ebca6b, 0xc2b2ae35];
  const primes = [0x01000193, 0x27d4eb2d, 0x165667b1, 0x85ebca77];
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    for (let hashIndex = 0; hashIndex < hashes.length; hashIndex += 1) {
      hashes[hashIndex] = Math.imul(hashes[hashIndex] ^ code, primes[hashIndex]);
    }
  }
  return hashes.map((hash) => (hash >>> 0).toString(16).padStart(8, '0')).join('');
}

/** Stable identity for the one Terminal owned by a saved project quick action. */
export function quickActionTerminalId(projectId: string, actionId: string): string {
  return `quick-action-${stableTerminalIdentityHash(JSON.stringify([projectId, actionId]))}`;
}

export type WorkspaceTerminalAction = 'open' | 'update' | 'login' | 'doctor';

export type WorkspaceTerminalRuntimeAction = {
  runtimeId: RuntimeId;
  action: WorkspaceTerminalAction;
};

export async function createScriptTerminalId({
  projectId,
  scopeId,
  taskId,
  type,
  script,
}: {
  projectId: string;
  scopeId?: string;
  taskId?: string;
  type: 'setup' | 'run' | 'teardown';
  script: string;
}) {
  const resolvedScopeId = scopeId ?? taskId;
  if (!resolvedScopeId) {
    throw new Error('createScriptTerminalId requires scopeId');
  }
  const key = `${projectId}::${resolvedScopeId}::${type}::${script}`;
  const hash = await createHash(key);
  return hash.slice(0, 32);
}
