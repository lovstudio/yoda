import { access, copyFile, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { HookSource, TaskHookOverrides } from '@shared/agent-hooks';
import type { AgentProviderId } from '@shared/agent-provider-registry';
import { log } from '@main/lib/logger';
import { unwrapShim, wrapHookCommand } from './hook-exec-shim';

const BACKUP_SUFFIX = '.yoda-bak';

type Layer = { source: HookSource; path: string };

function claudeLayers(cwd: string): Layer[] {
  return [
    { source: 'user', path: join(homedir(), '.claude', 'settings.json') },
    { source: 'project', path: join(cwd, '.claude', 'settings.json') },
    { source: 'local', path: join(cwd, '.claude', 'settings.local.json') },
  ];
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function readJson(path: string): Promise<Record<string, unknown> | null> {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

async function ensureBackup(path: string): Promise<void> {
  const backup = path + BACKUP_SUFFIX;
  if (await exists(backup)) return;
  await copyFile(path, backup);
}

async function restoreFromBackup(path: string): Promise<boolean> {
  const backup = path + BACKUP_SUFFIX;
  if (!(await exists(backup))) return false;
  await rename(backup, path);
  return true;
}

function hookId(source: HookSource, event: string, matcher: string, index: number): string {
  return `${source}:${event}:${matcher}:${index}`;
}

/**
 * Rewrite a single Claude settings layer applying disable + debug-wrap.
 * Returns true if the file content changed.
 */
function transformLayer(
  source: HookSource,
  config: Record<string, unknown>,
  disabled: Set<string>,
  debug: boolean
): boolean {
  const hooks = config.hooks;
  if (!hooks || typeof hooks !== 'object') return false;

  let changed = false;

  for (const [event, groupsRaw] of Object.entries(hooks as Record<string, unknown>)) {
    if (!Array.isArray(groupsRaw)) continue;
    let index = 0;
    for (const group of groupsRaw) {
      if (!group || typeof group !== 'object') continue;
      const matcher =
        typeof (group as { matcher?: unknown }).matcher === 'string'
          ? (group as { matcher: string }).matcher
          : '';
      const entries = (group as { hooks?: unknown }).hooks;
      if (!Array.isArray(entries)) continue;

      const keep: unknown[] = [];
      for (const entry of entries) {
        if (!entry || typeof entry !== 'object') {
          keep.push(entry);
          continue;
        }
        const cmd = (entry as { command?: unknown }).command;
        if (typeof cmd !== 'string') {
          keep.push(entry);
          continue;
        }
        const id = hookId(source, event, matcher, index);
        index += 1;

        if (disabled.has(id)) {
          changed = true;
          continue; // drop the entry entirely
        }

        const original = unwrapShim(cmd);
        const next = debug ? wrapHookCommand(original, id, event) : original;
        if (next !== cmd) {
          changed = true;
          keep.push({ ...(entry as object), command: next });
        } else {
          keep.push(entry);
        }
      }
      (group as { hooks: unknown[] }).hooks = keep;
    }
  }

  return changed;
}

/**
 * Apply a task's hook overrides to the real Claude settings files (local only).
 *
 * - When overrides are empty, restores any previously written backups (revert).
 * - Otherwise, backs up each touched file once, then drops disabled hooks and
 *   (when debug) wraps remaining commands with the exec-logging shim.
 *
 * Idempotent: re-running with the same overrides reproduces the same files,
 * because ids are recomputed from a freshly restored baseline each time.
 */
export async function applyClaudeHookOverrides(
  cwd: string,
  overrides: TaskHookOverrides
): Promise<void> {
  const layers = claudeLayers(cwd);
  const hasOverrides = overrides.disabled.length > 0 || overrides.debug;

  // Always start from the user's pristine baseline so ids stay stable and
  // toggling off reverts cleanly.
  for (const layer of layers) {
    if (await exists(layer.path + BACKUP_SUFFIX)) {
      await restoreFromBackup(layer.path);
    }
  }

  if (!hasOverrides) return;

  const disabled = new Set(overrides.disabled);
  for (const layer of layers) {
    if (!(await exists(layer.path))) continue;
    const config = await readJson(layer.path);
    if (!config) continue;
    const changed = transformLayer(layer.source, config, disabled, overrides.debug);
    if (!changed) continue;
    await ensureBackup(layer.path);
    await writeFile(layer.path, JSON.stringify(config, null, 2) + '\n');
  }
}

export async function applyHookOverrides(
  cwd: string,
  providerId: AgentProviderId,
  overrides: TaskHookOverrides
): Promise<void> {
  try {
    if (providerId === 'claude') {
      await applyClaudeHookOverrides(cwd, overrides);
    }
    // codex notify is a single global entry; toggling it is out of scope.
  } catch (err) {
    log.warn('applyHookOverrides failed', { error: String(err), providerId });
  }
}
