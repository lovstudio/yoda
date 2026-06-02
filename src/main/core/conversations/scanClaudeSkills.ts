import type { Dirent } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { log } from '@main/lib/logger';

/**
 * Scans the filesystem for skills/commands available to Claude Code right now —
 * bypassing the session transcript's `skill_listing` attachment, which is only
 * written once at session start. Output format matches the transcript listing
 * (`- name: description` lines) so downstream parsers stay the same.
 *
 * Scan paths mirror Claude Code's own resolution order:
 *   1. ~/.claude/commands/**\/*.md            (user slash commands)
 *   2. ~/.claude/skills/**\/SKILL.md          (user skills)
 *   3. <cwd>/.claude/commands/**\/*.md        (project commands)
 *   4. <cwd>/.claude/skills/**\/SKILL.md      (project skills)
 *   5. ~/.claude/plugins/cache/<mp>/<plugin>/<ver>/commands/**\/*.md
 *   6. ~/.claude/plugins/cache/<mp>/<plugin>/<ver>/skills/**\/SKILL.md
 *
 * Plugin entries are filtered to versions registered in installed_plugins.json.
 */
export async function scanClaudeSkills(cwd: string): Promise<string> {
  const home = homedir();
  const entries = new Map<string, string>();

  await Promise.all([
    scanCommandsTree(join(home, '.claude', 'commands'), '', entries),
    scanSkillsTree(join(home, '.claude', 'skills'), '', entries),
    scanCommandsTree(join(cwd, '.claude', 'commands'), '', entries),
    scanSkillsTree(join(cwd, '.claude', 'skills'), '', entries),
    scanPlugins(home, entries),
  ]);

  return [...entries.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, desc]) => (desc ? `- ${name}: ${desc}` : `- ${name}`))
    .join('\n');
}

async function scanCommandsTree(
  root: string,
  prefix: string,
  out: Map<string, string>
): Promise<void> {
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
        await scanCommandsTree(fullPath, nextPrefix, out);
        return;
      }
      if (!d.isFile() || !d.name.endsWith('.md')) return;
      const stem = d.name.slice(0, -3);
      const name = prefix ? `${prefix}:${stem}` : stem;
      const desc = await readFrontmatterDescription(fullPath);
      if (desc === null) return;
      if (!out.has(name)) out.set(name, desc);
    })
  );
}

async function scanSkillsTree(
  root: string,
  prefix: string,
  out: Map<string, string>
): Promise<void> {
  let dirents: Dirent[];
  try {
    dirents = await readdir(root, { withFileTypes: true });
  } catch {
    return;
  }
  await Promise.all(
    dirents.map(async (d) => {
      if (!d.isDirectory()) return;
      const fullPath = join(root, d.name);
      const nextPrefix = prefix ? `${prefix}:${d.name}` : d.name;
      const skillFile = join(fullPath, 'SKILL.md');
      const desc = await readFrontmatterDescription(skillFile);
      if (desc !== null) {
        if (!out.has(nextPrefix)) out.set(nextPrefix, desc);
      }
      await scanSkillsTree(fullPath, nextPrefix, out);
    })
  );
}

async function scanPlugins(home: string, out: Map<string, string>): Promise<void> {
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
    log.debug('scanClaudeSkills: bad installed_plugins.json', { error: String(err) });
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
        await Promise.all([
          scanCommandsTree(join(installPath, 'commands'), pluginName, out),
          scanSkillsTree(join(installPath, 'skills'), pluginName, out),
          // some plugins nest skills one level deeper (lovstudio: skills/skills/<name>/SKILL.md)
          scanSkillsTree(join(installPath, 'skills', 'skills'), pluginName, out),
        ]);
      });
    })
  );
}

async function readFrontmatterDescription(path: string): Promise<string | null> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch {
    return null;
  }
  if (!raw.startsWith('---')) return '';
  const end = raw.indexOf('\n---', 3);
  if (end === -1) return '';
  const yaml = raw.slice(3, end);
  const match = yaml.match(/^description:\s*(.+?)\s*$/m);
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
