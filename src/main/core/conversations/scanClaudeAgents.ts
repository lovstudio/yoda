import type { Dirent } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { log } from '@main/lib/logger';

/**
 * Returns the set of agent type names available to Claude Code right now,
 * bypassing the transcript's `agent_listing_delta` attachment (which is only
 * written at session start). Mirrors Claude Code's agent resolution:
 *
 *   1. ~/.claude/agents/**\/*.md            (user agents)
 *   2. <cwd>/.claude/agents/**\/*.md        (project agents)
 *   3. ~/.claude/plugins/cache/<mp>/<plugin>/<ver>/agents/**\/*.md
 *      (named "<plugin>:<agent>")
 */
const BUILTIN_AGENTS = ['claude', 'Explore', 'Plan', 'general-purpose', 'statusline-setup'];

export async function scanClaudeAgents(cwd: string): Promise<string[]> {
  const home = homedir();
  const names = new Set<string>(BUILTIN_AGENTS);

  await Promise.all([
    scanAgentsTree(join(home, '.claude', 'agents'), '', names),
    scanAgentsTree(join(cwd, '.claude', 'agents'), '', names),
    scanPluginAgents(home, names),
  ]);

  return [...names].sort();
}

async function scanAgentsTree(root: string, prefix: string, out: Set<string>): Promise<void> {
  let dirents: Dirent[];
  try {
    dirents = await readdir(root, { withFileTypes: true });
  } catch {
    return;
  }
  await Promise.all(
    dirents.map(async (d) => {
      const fullPath = join(root, d.name);
      if (d.isDirectory()) {
        const nextPrefix = prefix ? `${prefix}:${d.name}` : d.name;
        await scanAgentsTree(fullPath, nextPrefix, out);
        return;
      }
      if (!d.isFile() || !d.name.endsWith('.md')) return;
      // skip backups like agent.md.backup.YYYYMMDD
      if (d.name.includes('.backup')) return;
      const stem = d.name.slice(0, -3);
      const name = prefix ? `${prefix}:${stem}` : stem;
      out.add(name);
    })
  );
}

async function scanPluginAgents(home: string, out: Set<string>): Promise<void> {
  const manifestPath = join(home, '.claude', 'plugins', 'installed_plugins.json');
  let manifestRaw: string;
  try {
    manifestRaw = await readFile(manifestPath, 'utf8');
  } catch {
    return;
  }
  let manifest: unknown;
  try {
    manifest = JSON.parse(manifestRaw);
  } catch (err) {
    log.debug('scanClaudeAgents: bad installed_plugins.json', { error: String(err) });
    return;
  }
  const plugins = (manifest as { plugins?: Record<string, unknown> })?.plugins;
  if (!plugins || typeof plugins !== 'object') return;

  await Promise.all(
    Object.entries(plugins).flatMap(([key, installs]) => {
      if (!Array.isArray(installs)) return [];
      const pluginName = key.split('@')[0];
      return installs.map(async (install) => {
        const installPath = (install as { installPath?: unknown })?.installPath;
        if (typeof installPath !== 'string') return;
        await scanAgentsTree(join(installPath, 'agents'), pluginName, out);
      });
    })
  );
}
