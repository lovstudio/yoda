import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parse as parseToml } from 'smol-toml';
import type {
  HookInspectionResult,
  HookSource,
  InspectedHook,
  TaskHookOverrides,
} from '@shared/agent-hooks';
import { getProvider, type AgentProviderId } from '@shared/agent-provider-registry';

const YODA_MARKER = 'YODA_HOOK_PORT';

type ClaudeLayer = { source: HookSource; path: string };

function claudeLayers(cwd: string): ClaudeLayer[] {
  return [
    { source: 'user', path: join(homedir(), '.claude', 'settings.json') },
    { source: 'project', path: join(cwd, '.claude', 'settings.json') },
    { source: 'local', path: join(cwd, '.claude', 'settings.local.json') },
  ];
}

async function readJson(path: string): Promise<Record<string, unknown> | null> {
  try {
    const raw = await readFile(path, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function hookId(source: HookSource, event: string, matcher: string, index: number): string {
  return `${source}:${event}:${matcher}:${index}`;
}

/**
 * Parse a Claude settings `hooks` object into flat InspectedHook entries.
 * Shape: { [event]: [{ matcher?, hooks: [{ type, command }] }] }
 */
function parseClaudeHooks(
  source: HookSource,
  sourcePath: string,
  config: Record<string, unknown>
): InspectedHook[] {
  const hooks = config.hooks;
  if (!hooks || typeof hooks !== 'object') return [];
  const out: InspectedHook[] = [];

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
      for (const entry of entries) {
        if (!entry || typeof entry !== 'object') continue;
        const command = (entry as { command?: unknown }).command;
        if (typeof command !== 'string') continue;
        out.push({
          id: hookId(source, event, matcher, index),
          event,
          matcher: matcher || undefined,
          command,
          source,
          sourcePath,
          managedByYoda: command.includes(YODA_MARKER),
          enabled: true,
        });
        index += 1;
      }
    }
  }
  return out;
}

async function inspectClaude(cwd: string): Promise<{ hooks: InspectedHook[]; sources: string[] }> {
  const hooks: InspectedHook[] = [];
  const sources: string[] = [];
  for (const layer of claudeLayers(cwd)) {
    const config = await readJson(layer.path);
    if (!config) continue;
    sources.push(layer.path);
    hooks.push(...parseClaudeHooks(layer.source, layer.path, config));
  }
  return { hooks, sources };
}

async function inspectCodex(): Promise<{ hooks: InspectedHook[]; sources: string[] }> {
  const path = join(homedir(), '.codex', 'config.toml');
  let config: Record<string, unknown> | null = null;
  try {
    config = parseToml(await readFile(path, 'utf8')) as Record<string, unknown>;
  } catch {
    return { hooks: [], sources: [] };
  }
  const notify = config.notify;
  const command = Array.isArray(notify) ? notify.join(' ') : undefined;
  if (!command) return { hooks: [], sources: [path] };
  return {
    sources: [path],
    hooks: [
      {
        id: hookId('codex', 'notify', '', 0),
        event: 'notify',
        command,
        source: 'codex',
        sourcePath: path,
        managedByYoda: command.includes(YODA_MARKER),
        enabled: true,
      },
    ],
  };
}

export async function inspectHooks(
  cwd: string,
  providerId: AgentProviderId,
  overrides: TaskHookOverrides
): Promise<HookInspectionResult> {
  const supported = getProvider(providerId)?.supportsHooks === true;
  if (!supported) {
    return { providerId, supported: false, sources: [], hooks: [] };
  }

  const { hooks, sources } =
    providerId === 'codex' ? await inspectCodex() : await inspectClaude(cwd);

  const disabled = new Set(overrides.disabled);
  for (const hook of hooks) {
    hook.enabled = !disabled.has(hook.id);
  }

  return { providerId, supported: true, sources, hooks };
}
