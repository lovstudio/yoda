import type { Dirent } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

export async function scanCodexSkills(cwd: string): Promise<string> {
  const home = homedir();
  const entries = new Map<string, string>();

  await Promise.all([
    scanSkillsTree(join(home, '.codex', 'skills'), '', entries),
    scanSkillsTree(join(cwd, '.codex', 'skills'), '', entries),
  ]);

  return [...entries.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, desc]) => (desc ? `- ${name}: ${desc}` : `- ${name}`))
    .join('\n');
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
      if (desc !== null && !out.has(nextPrefix)) {
        out.set(nextPrefix, desc);
      }
      await scanSkillsTree(fullPath, nextPrefix, out);
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
