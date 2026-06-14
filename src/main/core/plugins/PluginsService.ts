import type { Dirent } from 'node:fs';
import { readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import type {
  InstalledPlugin,
  PluginBundledSkill,
  PluginComponentCounts,
  PluginIndex,
} from '@shared/plugins/types';
import { log } from '@main/lib/logger';

const PLUGINS_DIR = () => join(homedir(), '.claude', 'plugins');
const MANIFEST = () => join(PLUGINS_DIR(), 'installed_plugins.json');
const SETTINGS = () => join(homedir(), '.claude', 'settings.json');

interface ManifestInstall {
  installPath?: string;
  version?: string;
  installedAt?: string;
}
interface Manifest {
  version?: number;
  plugins?: Record<string, ManifestInstall[]>;
}

async function readJson<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T;
  } catch {
    return null;
  }
}

/** Pulls `description:` out of YAML frontmatter without a full parser. */
function frontmatterDescription(raw: string): string {
  if (!raw.startsWith('---')) return '';
  const end = raw.indexOf('\n---', 3);
  if (end === -1) return '';
  const match = raw.slice(3, end).match(/^description:\s*(.+?)\s*$/m);
  if (!match) return '';
  const value = match[1].trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

async function listDir(path: string): Promise<Dirent[]> {
  try {
    return await readdir(path, { withFileTypes: true });
  } catch {
    return [];
  }
}

/** Recursively counts `.md` files under a directory (slash commands / agents). */
async function countMarkdown(dir: string): Promise<number> {
  let count = 0;
  for (const d of await listDir(dir)) {
    if (d.isDirectory()) count += await countMarkdown(join(dir, d.name));
    else if (d.isFile() && d.name.endsWith('.md')) count += 1;
  }
  return count;
}

/** Collects slash command names (path-relative, `:`-joined) under commands/. */
async function listCommands(root: string, prefix: string): Promise<string[]> {
  const out: string[] = [];
  for (const d of await listDir(root)) {
    const full = join(root, d.name);
    if (d.isDirectory()) {
      const next = prefix ? `${prefix}:${d.name}` : d.name;
      out.push(...(await listCommands(full, next)));
    } else if (d.isFile() && d.name.endsWith('.md')) {
      const stem = d.name.slice(0, -3);
      out.push(prefix ? `${prefix}:${stem}` : stem);
    }
  }
  return out;
}

/**
 * Reads bundled skills from `<root>/<name>/SKILL.md`. Some plugins nest skills
 * one level deeper (lovstudio: skills/skills/<name>/SKILL.md), so callers pass
 * both `skills` and `skills/skills`.
 */
async function listSkills(root: string): Promise<PluginBundledSkill[]> {
  const out: PluginBundledSkill[] = [];
  for (const d of await listDir(root)) {
    if (!d.isDirectory()) continue;
    try {
      const raw = await readFile(join(root, d.name, 'SKILL.md'), 'utf8');
      out.push({ name: d.name, description: frontmatterDescription(raw) });
    } catch {
      // Not a skill directory; skip.
    }
  }
  return out;
}

async function countMcpServers(installPath: string): Promise<number> {
  const mcp = await readJson<{ mcpServers?: Record<string, unknown> }>(
    join(installPath, '.mcp.json')
  );
  return mcp?.mcpServers ? Object.keys(mcp.mcpServers).length : 0;
}

async function countHooks(installPath: string): Promise<number> {
  const hooks = await readJson<{ hooks?: Record<string, unknown[]> }>(
    join(installPath, 'hooks', 'hooks.json')
  );
  if (!hooks?.hooks) return 0;
  return Object.values(hooks.hooks).reduce(
    (sum, entries) => sum + (Array.isArray(entries) ? entries.length : 0),
    0
  );
}

function parseAuthor(author: unknown): string | undefined {
  if (typeof author === 'string') return author;
  if (author && typeof author === 'object' && 'name' in author) {
    const name = (author as { name?: unknown }).name;
    if (typeof name === 'string') return name;
  }
  return undefined;
}

async function buildPlugin(
  id: string,
  install: ManifestInstall,
  enabledMap: Record<string, boolean>
): Promise<InstalledPlugin | null> {
  const installPath = install.installPath;
  if (typeof installPath !== 'string') return null;
  const [name, marketplace] = id.split('@');

  const meta = await readJson<{ description?: string; author?: unknown; version?: string }>(
    join(installPath, '.claude-plugin', 'plugin.json')
  );

  const [commands, nestedSkills, deepSkills, agentCount, mcpServers, hooks] = await Promise.all([
    listCommands(join(installPath, 'commands'), name),
    listSkills(join(installPath, 'skills')),
    listSkills(join(installPath, 'skills', 'skills')),
    countMarkdown(join(installPath, 'agents')),
    countMcpServers(installPath),
    countHooks(installPath),
  ]);

  const skills = [...nestedSkills, ...deepSkills];
  const components: PluginComponentCounts = {
    commands: commands.length,
    skills: skills.length,
    agents: agentCount,
    hooks,
    mcpServers,
  };

  return {
    id,
    name,
    marketplace: marketplace || undefined,
    description: meta?.description,
    author: parseAuthor(meta?.author),
    version: meta?.version ?? install.version,
    installPath,
    installedAt: install.installedAt,
    // Absent from enabledPlugins means enabled-by-default; only explicit false disables.
    enabled: enabledMap[id] !== false,
    components,
    skills,
    commands,
  };
}

class PluginsService {
  private cache: PluginIndex | null = null;

  async getIndex(): Promise<PluginIndex> {
    if (this.cache) return this.cache;
    return this.refresh();
  }

  async refresh(): Promise<PluginIndex> {
    const manifest = await readJson<Manifest>(MANIFEST());
    const settings = await readJson<{ enabledPlugins?: Record<string, boolean> }>(SETTINGS());
    const enabledMap = settings?.enabledPlugins ?? {};

    const entries = manifest?.plugins ?? {};
    const built = await Promise.all(
      Object.entries(entries).flatMap(([id, installs]) =>
        (Array.isArray(installs) ? installs : []).map((install) =>
          buildPlugin(id, install, enabledMap)
        )
      )
    );

    const plugins = built
      .filter((p): p is InstalledPlugin => p !== null)
      .sort((a, b) => a.name.localeCompare(b.name));

    this.cache = {
      version: 1,
      lastUpdated: new Date().toISOString(),
      plugins,
    };
    return this.cache;
  }

  async setEnabled(id: string, enabled: boolean): Promise<InstalledPlugin> {
    const settings = (await readJson<Record<string, unknown>>(SETTINGS())) ?? {};
    const enabledPlugins = {
      ...((settings.enabledPlugins as Record<string, boolean> | undefined) ?? {}),
      [id]: enabled,
    };
    await writeFile(
      SETTINGS(),
      `${JSON.stringify({ ...settings, enabledPlugins }, null, 2)}\n`,
      'utf8'
    );
    this.cache = null;
    const index = await this.refresh();
    const plugin = index.plugins.find((p) => p.id === id);
    if (!plugin) throw new Error(`Plugin not found after update: ${id}`);
    return plugin;
  }

  /**
   * Uninstalls a plugin: drops it from installed_plugins.json + enabledPlugins,
   * then deletes its install directory. Mirrors Claude Code's own removal.
   */
  async uninstall(id: string): Promise<void> {
    const manifest = (await readJson<Manifest>(MANIFEST())) ?? {};
    const plugins = manifest.plugins ?? {};
    const installs = plugins[id];
    if (!installs) throw new Error(`Plugin not installed: ${id}`);

    // Delete each install dir, but only inside ~/.claude/plugins as a guardrail.
    const pluginsRoot = resolve(PLUGINS_DIR()) + sep;
    for (const install of installs) {
      const path = install.installPath;
      if (typeof path !== 'string') continue;
      if (!resolve(path).startsWith(pluginsRoot)) {
        log.warn('Refusing to delete plugin path outside plugins dir', { id, path });
        continue;
      }
      await rm(path, { recursive: true, force: true });
    }

    delete plugins[id];
    await writeFile(MANIFEST(), `${JSON.stringify({ ...manifest, plugins }, null, 2)}\n`, 'utf8');

    const settings = (await readJson<Record<string, unknown>>(SETTINGS())) ?? {};
    const enabledPlugins = { ...((settings.enabledPlugins as Record<string, boolean>) ?? {}) };
    if (id in enabledPlugins) {
      delete enabledPlugins[id];
      await writeFile(
        SETTINGS(),
        `${JSON.stringify({ ...settings, enabledPlugins }, null, 2)}\n`,
        'utf8'
      );
    }

    this.cache = null;
  }
}

export const pluginsService = new PluginsService();
