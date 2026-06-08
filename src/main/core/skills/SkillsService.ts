import * as fs from 'node:fs';
import * as https from 'node:https';
import * as os from 'node:os';
import * as path from 'node:path';
import { agentTargets, skillScanPaths } from '@shared/skills/agentTargets';
import type { CatalogIndex, CatalogSkill, DetectedAgent } from '@shared/skills/types';
import {
  generateSkillMd,
  isValidSkillName,
  parseFrontmatter,
  validateSkillFrontmatter,
} from '@shared/skills/validation';
import { log } from '@main/lib/logger';
import bundledCatalog from './bundled-catalog.json';

const SKILLS_ROOT = path.join(os.homedir(), '.agentskills');
const YODA_META = path.join(SKILLS_ROOT, '.yoda');
const CATALOG_INDEX_PATH = path.join(YODA_META, 'catalog-index.json');
const SKILL_MD_FILENAME = 'SKILL.md';
const DISABLED_SKILL_MD_FILENAME = 'SKILL.md.disabled';

/**
 * Skill directories scanned relative to a selected project root, so the picker
 * surfaces project-local skills alongside the global ones.
 */
const PROJECT_SKILL_SUBDIRS = [
  path.join('.claude', 'commands'),
  path.join('.claude', 'skills'),
  path.join('.codex', 'skills'),
  path.join('.agentskills'),
];

const MAX_REDIRECTS = 5;

function isPathInside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return (
    relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative))
  );
}

function httpsGet(url: string, redirectCount = 0): Promise<string> {
  return new Promise((resolve, reject) => {
    if (redirectCount >= MAX_REDIRECTS) {
      reject(new Error(`Too many redirects (>${MAX_REDIRECTS}) for ${url}`));
      return;
    }
    const req = https.get(
      url,
      { headers: { 'User-Agent': 'yoda-skills', Accept: 'application/vnd.github.v3+json' } },
      (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          const location = res.headers.location;
          if (location) {
            const resolved = new URL(location, url).href;
            httpsGet(resolved, redirectCount + 1).then(resolve, reject);
            return;
          }
        }
        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error(`HTTP ${res.statusCode} for ${url}`));
          return;
        }
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => resolve(data));
        res.on('error', reject);
      }
    );
    req.on('error', reject);
    req.setTimeout(15000, () => {
      req.destroy(new Error('Request timed out'));
    });
  });
}

export class SkillsService {
  private static readonly CATALOG_VERSION = 3;
  private catalogCache: CatalogIndex | null = null;

  async initialize(): Promise<void> {
    await fs.promises.mkdir(SKILLS_ROOT, { recursive: true });
    await fs.promises.mkdir(YODA_META, { recursive: true });
  }

  /**
   * @param projectPath When provided (local project root), project-local skill
   *   directories are scanned and merged in alongside the global ones.
   */
  async getCatalogIndex(projectPath?: string): Promise<CatalogIndex> {
    if (this.catalogCache) {
      return this.mergeInstalledState(this.catalogCache, projectPath);
    }

    // Try disk cache — only use if its version matches current
    try {
      const data = await fs.promises.readFile(CATALOG_INDEX_PATH, 'utf-8');
      const diskCache = JSON.parse(data) as CatalogIndex;
      if (diskCache.version >= SkillsService.CATALOG_VERSION) {
        this.catalogCache = diskCache;
        return this.mergeInstalledState(this.catalogCache, projectPath);
      }
      // Stale disk cache — fall through to bundled
    } catch {
      // No disk cache — fall back to bundled catalog
    }

    const bundled = this.loadBundledCatalog();
    this.catalogCache = bundled;
    return this.mergeInstalledState(bundled, projectPath);
  }

  /** Skill directories under a project root that may contain local skills. */
  private projectSkillDirs(projectPath?: string): string[] {
    if (!projectPath) return [];
    return PROJECT_SKILL_SUBDIRS.map((subdir) => path.join(projectPath, subdir));
  }

  async refreshCatalog(): Promise<CatalogIndex> {
    try {
      const [openaiSkills, anthropicSkills] = await Promise.allSettled([
        this.fetchOpenAICatalog(),
        this.fetchAnthropicCatalog(),
      ]);

      const allSkills: CatalogSkill[] = [];
      if (openaiSkills.status === 'fulfilled') {
        allSkills.push(...openaiSkills.value);
      }
      if (anthropicSkills.status === 'fulfilled') {
        allSkills.push(...anthropicSkills.value);
      }

      // Deduplicate by id — first occurrence wins
      const seen = new Set<string>();
      const skills = allSkills.filter((s) => {
        if (seen.has(s.id)) return false;
        seen.add(s.id);
        return true;
      });

      // If both failed, fall back to bundled
      if (skills.length === 0) {
        log.warn('Failed to fetch any remote catalogs, using bundled');
        return this.getCatalogIndex();
      }

      const catalog: CatalogIndex = {
        version: SkillsService.CATALOG_VERSION,
        lastUpdated: new Date().toISOString(),
        skills,
      };

      this.catalogCache = catalog;
      await fs.promises.writeFile(CATALOG_INDEX_PATH, JSON.stringify(catalog, null, 2));
      return this.mergeInstalledState(catalog);
    } catch (error) {
      log.error('Failed to refresh catalog:', error);
      return this.getCatalogIndex();
    }
  }

  async getInstalledSkills(extraDirs: string[] = []): Promise<CatalogSkill[]> {
    await this.initialize();
    const seen = new Set<string>();
    const skills: CatalogSkill[] = [];

    // Scan all known skill directories (central + agent-specific + project-local).
    // Project-local dirs go last so global skills with the same id win.
    const dirsToScan = [SKILLS_ROOT, ...skillScanPaths, ...extraDirs];

    for (const dir of dirsToScan) {
      let entries: fs.Dirent[];
      try {
        entries = await fs.promises.readdir(dir, { withFileTypes: true });
      } catch {
        continue; // Directory doesn't exist
      }

      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue;
        if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
        if (seen.has(entry.name)) continue; // Already found this skill

        let skillDir = path.join(dir, entry.name);

        // Resolve symlinks to get the real path and verify it's a directory
        try {
          const realPath = await fs.promises.realpath(skillDir);
          const stat = await fs.promises.stat(realPath);
          if (!stat.isDirectory()) continue;
          skillDir = realPath;
        } catch (err) {
          // Broken symlink: surface the dangling target so the user can fix it
          // (e.g. `rm <skillDir>` to delete the bad link).
          if (entry.isSymbolicLink() && (err as NodeJS.ErrnoException)?.code === 'ENOENT') {
            const target = await fs.promises.readlink(skillDir).catch(() => '<unreadable>');
            log.warn(
              `Skipping skill "${entry.name}": broken symlink at ${skillDir} → ${target} (target does not exist). ` +
                `Fix: \`rm "${skillDir}"\` or restore the target.`
            );
          } else {
            log.warn(`Skipping skill "${entry.name}" in ${dir}: failed to resolve path`, err);
          }
          continue;
        }

        const localSkill = await this.readLocalSkill(skillDir);
        if (localSkill) {
          seen.add(entry.name);
          skills.push(
            this.buildLocalSkill(entry.name, skillDir, localSkill.content, {
              disabled: localSkill.disabled,
            })
          );
        }
      }
    }

    return skills;
  }

  async getSkillDetail(skillId: string): Promise<CatalogSkill | null> {
    const catalog = await this.getCatalogIndex();
    const skill = catalog.skills.find((s) => s.id === skillId);
    if (!skill) return null;

    // If installed, load the full SKILL.md from disk
    if (skill.installed && skill.localPath) {
      try {
        const localSkill = await this.readLocalSkill(skill.localPath);
        if (!localSkill) return skill;
        return this.mergeCatalogSkillWithLocal(
          skill,
          this.buildLocalSkill(skill.id, skill.localPath, localSkill.content, {
            disabled: localSkill.disabled,
          })
        );
      } catch {
        // Return what we have
      }
    }

    // For uninstalled catalog skills, fetch SKILL.md from GitHub
    if (!skill.installed && !skill.skillMdContent) {
      try {
        const mdUrl = this.getSkillMdUrl(skill);
        if (mdUrl) {
          const content = await httpsGet(mdUrl);
          return { ...skill, skillMdContent: content };
        }
      } catch {
        // Return what we have
      }
    }

    return skill;
  }

  private getSkillMdUrl(skill: CatalogSkill): string | null {
    if (skill.source === 'openai' && skill.sourceUrl) {
      // e.g. https://github.com/openai/skills/tree/main/skills/.curated/linear
      // → https://raw.githubusercontent.com/openai/skills/main/skills/.curated/linear/SKILL.md
      const match = skill.sourceUrl.match(/github\.com\/([^/]+\/[^/]+)\/tree\/main\/(.+)/);
      if (match) {
        return `https://raw.githubusercontent.com/${match[1]}/main/${match[2]}/SKILL.md`;
      }
    }
    if (skill.source === 'anthropic' && skill.sourceUrl) {
      const match = skill.sourceUrl.match(/github\.com\/([^/]+\/[^/]+)\/tree\/main\/(.+)/);
      if (match) {
        return `https://raw.githubusercontent.com/${match[1]}/main/${match[2]}/SKILL.md`;
      }
    }
    return null;
  }

  async installSkill(skillId: string): Promise<CatalogSkill> {
    await this.initialize();
    const catalog = await this.getCatalogIndex();
    const skill = catalog.skills.find((s) => s.id === skillId);
    if (!skill) throw new Error(`Skill "${skillId}" not found in catalog`);
    if (skill.installed) throw new Error(`Skill "${skillId}" is already installed`);

    const skillDir = path.join(SKILLS_ROOT, skillId);
    const tmpDir = `${skillDir}.tmp-${Date.now()}`;
    try {
      await fs.promises.mkdir(tmpDir, { recursive: true });

      // Try to download the real SKILL.md from GitHub; fall back to generated stub
      let content: string;
      try {
        const mdUrl = this.getSkillMdUrl(skill);
        if (mdUrl) {
          content = await httpsGet(mdUrl);
        } else {
          content = generateSkillMd(skill.displayName, skill.description);
        }
      } catch {
        content = generateSkillMd(skill.displayName, skill.description);
      }
      await fs.promises.writeFile(path.join(tmpDir, SKILL_MD_FILENAME), content);

      // Remove stale target dir if present (e.g. from a previous failed install)
      await fs.promises.rm(skillDir, { recursive: true, force: true }).catch(() => {});

      // Atomic move: rename tmp dir to final location
      await fs.promises.rename(tmpDir, skillDir);

      // Sync to agents
      await this.syncToAgents(skillId);

      // Invalidate cache
      this.catalogCache = null;

      return {
        ...skill,
        installed: true,
        disabled: false,
        localPath: skillDir,
        skillMdContent: content,
      };
    } catch (error) {
      // Clean up partial install
      await fs.promises.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
      await fs.promises.rm(skillDir, { recursive: true, force: true }).catch(() => {});
      throw error;
    }
  }

  async uninstallSkill(skillId: string): Promise<void> {
    const skillDir = path.join(SKILLS_ROOT, skillId);

    // Remove agent symlinks first
    await this.unsyncFromAgents(skillId);

    // Remove skill directory
    try {
      await fs.promises.rm(skillDir, { recursive: true, force: true });
    } catch (error) {
      log.error(`Failed to remove skill directory ${skillDir}:`, error);
      throw error;
    }

    // Invalidate cache
    this.catalogCache = null;
  }

  async createSkill(name: string, description: string, content?: string): Promise<CatalogSkill> {
    if (!isValidSkillName(name)) {
      throw new Error(
        'Invalid skill name. Use lowercase letters, numbers, and hyphens (1-64 chars).'
      );
    }

    await this.initialize();
    const skillDir = path.join(SKILLS_ROOT, name);

    try {
      await fs.promises.access(skillDir);
      throw new Error(`Skill "${name}" already exists`);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }

    await fs.promises.mkdir(skillDir, { recursive: true });

    const skillContent = generateSkillMd(name, description, content?.trim());

    await fs.promises.writeFile(path.join(skillDir, SKILL_MD_FILENAME), skillContent);

    // Sync to agents
    await this.syncToAgents(name);

    // Invalidate cache
    this.catalogCache = null;

    const { frontmatter } = parseFrontmatter(skillContent);
    return {
      id: name,
      displayName: name,
      description,
      source: 'local',
      frontmatter,
      installed: true,
      disabled: false,
      localPath: skillDir,
      skillMdContent: skillContent,
    };
  }

  async setSkillDisabled(skillId: string, disabled: boolean): Promise<CatalogSkill> {
    await this.initialize();
    const catalog = await this.getCatalogIndex();
    const skill = catalog.skills.find((s) => s.id === skillId);
    if (!skill) throw new Error(`Skill "${skillId}" not found in catalog`);
    if (!skill.installed || !skill.localPath) {
      throw new Error(`Skill "${skillId}" is not installed`);
    }

    const activePath = path.join(skill.localPath, SKILL_MD_FILENAME);
    const disabledPath = path.join(skill.localPath, DISABLED_SKILL_MD_FILENAME);

    if (disabled) {
      if (!skill.disabled) {
        await this.assertMissingFile(disabledPath, 'disabled skill file');
        await fs.promises.rename(activePath, disabledPath);
      }
      await this.unsyncFromAgents(skillId);
    } else {
      if (skill.disabled) {
        await this.assertMissingFile(activePath, 'active skill file');
        await fs.promises.rename(disabledPath, activePath);
      }
      if (this.isYodaManagedSkillPath(skill.localPath)) {
        await this.syncToAgents(skillId);
      }
    }

    this.catalogCache = null;
    const updated = await this.getSkillDetail(skillId);
    if (!updated) throw new Error(`Skill "${skillId}" not found after update`);
    return updated;
  }

  async syncToAgents(skillId: string): Promise<void> {
    const skillDir = path.join(SKILLS_ROOT, skillId);
    for (const target of agentTargets) {
      try {
        // Only sync if the agent's config dir exists (agent is installed)
        await fs.promises.access(target.configDir);
        const targetDir = target.getSkillDir(skillId);
        const parentDir = path.dirname(targetDir);
        await fs.promises.mkdir(parentDir, { recursive: true });

        // Remove existing symlink/dir if present
        try {
          const stat = await fs.promises.lstat(targetDir);
          if (stat.isSymbolicLink() || stat.isDirectory()) {
            await fs.promises.rm(targetDir, { recursive: true, force: true });
          }
        } catch {
          // Doesn't exist, that's fine
        }

        await fs.promises.symlink(skillDir, targetDir, 'junction');
      } catch (err) {
        // Agent not installed — expected; log unexpected failures
        const code = (err as NodeJS.ErrnoException).code;
        if (code !== 'ENOENT') {
          log.warn(`Failed to sync skill "${skillId}" to ${target.name}:`, err);
        }
      }
    }
  }

  async unsyncFromAgents(skillId: string): Promise<void> {
    for (const target of agentTargets) {
      try {
        const targetDir = target.getSkillDir(skillId);
        const stat = await fs.promises.lstat(targetDir);
        if (stat.isSymbolicLink()) {
          // Only remove symlinks that point into our central skills root
          const linkTarget = await fs.promises.readlink(targetDir);
          const resolved = path.resolve(path.dirname(targetDir), linkTarget);
          if (resolved.startsWith(SKILLS_ROOT)) {
            await fs.promises.unlink(targetDir);
          }
        }
        // Never rm -rf real directories in agent config — they may be user-managed
      } catch {
        // Doesn't exist or can't remove — skip
      }
    }
  }

  async getDetectedAgents(): Promise<DetectedAgent[]> {
    const agents: DetectedAgent[] = [];
    for (const target of agentTargets) {
      let installed = false;
      try {
        await fs.promises.access(target.configDir);
        installed = true;
      } catch {
        // Not installed
      }
      agents.push({
        id: target.id,
        name: target.name,
        configDir: target.configDir,
        installed,
      });
    }
    return agents;
  }

  // --- Private helpers ---

  private async readLocalSkill(
    skillDir: string
  ): Promise<{ content: string; disabled: boolean } | null> {
    try {
      return {
        content: await fs.promises.readFile(path.join(skillDir, SKILL_MD_FILENAME), 'utf-8'),
        disabled: false,
      };
    } catch {
      // Fall through to the disabled marker file.
    }

    try {
      return {
        content: await fs.promises.readFile(
          path.join(skillDir, DISABLED_SKILL_MD_FILENAME),
          'utf-8'
        ),
        disabled: true,
      };
    } catch {
      return null;
    }
  }

  private async assertMissingFile(filePath: string, label: string): Promise<void> {
    try {
      await fs.promises.access(filePath);
      throw new Error(`Cannot update skill: ${label} already exists at ${filePath}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
  }

  private isYodaManagedSkillPath(skillPath: string): boolean {
    return isPathInside(SKILLS_ROOT, skillPath) && !isPathInside(YODA_META, skillPath);
  }

  private loadBundledCatalog(): CatalogIndex {
    return bundledCatalog as CatalogIndex;
  }

  private async mergeInstalledState(
    catalog: CatalogIndex,
    projectPath?: string
  ): Promise<CatalogIndex> {
    const installed = await this.getInstalledSkills(this.projectSkillDirs(projectPath));
    const installedMap = new Map(installed.map((s) => [s.id, s]));

    // Deduplicate catalog skills by id (first occurrence wins)
    const seen = new Set<string>();
    const dedupedSkills = catalog.skills.filter((s) => {
      if (seen.has(s.id)) return false;
      seen.add(s.id);
      return true;
    });

    const mergedSkills = dedupedSkills.map((skill) => {
      const local = installedMap.get(skill.id);
      if (local) {
        installedMap.delete(skill.id);
        return this.mergeCatalogSkillWithLocal(skill, local);
      }
      return { ...skill, installed: false, disabled: false };
    });

    // Add locally-installed skills not in the catalog
    for (const local of installedMap.values()) {
      mergedSkills.push(local);
    }

    return { ...catalog, skills: mergedSkills };
  }

  private buildLocalSkill(
    id: string,
    skillDir: string,
    content: string,
    options: { disabled?: boolean } = {}
  ): CatalogSkill {
    const { frontmatter } = parseFrontmatter(content);
    const skillFilePath = path.join(skillDir, 'SKILL.md');
    const validationIssues = validateSkillFrontmatter(frontmatter, { skillFilePath });

    return {
      id,
      displayName: frontmatter.name || id,
      description: frontmatter.description || '',
      source: 'local',
      frontmatter,
      validationIssues,
      installed: true,
      disabled: options.disabled ?? false,
      localPath: skillDir,
      skillMdContent: content,
    };
  }

  private mergeCatalogSkillWithLocal(
    catalogSkill: CatalogSkill,
    local: CatalogSkill
  ): CatalogSkill {
    return {
      ...catalogSkill,
      displayName: local.displayName || catalogSkill.displayName,
      description: local.description || catalogSkill.description,
      frontmatter: local.frontmatter,
      validationIssues: local.validationIssues,
      installed: true,
      disabled: local.disabled ?? false,
      localPath: local.localPath,
      skillMdContent: local.skillMdContent,
    };
  }

  private async fetchOpenAICatalog(): Promise<CatalogSkill[]> {
    const baseUrl = 'https://api.github.com/repos/openai/skills/contents/skills';
    const rawBase = 'https://raw.githubusercontent.com/openai/skills/main/skills';

    // Fetch both curated and system skills
    const [curatedData, systemData] = await Promise.all([
      httpsGet(`${baseUrl}/.curated`),
      httpsGet(`${baseUrl}/.system`).catch(() => '[]'),
    ]);

    const curatedEntries = JSON.parse(curatedData) as Array<{
      name: string;
      type: string;
      html_url?: string;
    }>;
    const systemEntries = JSON.parse(systemData) as Array<{
      name: string;
      type: string;
      html_url?: string;
    }>;

    const allEntries = [
      ...curatedEntries.map((e) => ({ ...e, category: '.curated' as const })),
      ...systemEntries.map((e) => ({ ...e, category: '.system' as const })),
    ].filter((e) => e.type === 'dir');

    // Fetch openai.yaml for each skill in parallel (with fallback)
    const skills = await Promise.all(
      allEntries.map(async (entry) => {
        const fallbackName = entry.name
          .split('-')
          .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
          .join(' ');

        let displayName = fallbackName;
        let description = '';
        let iconUrl: string | undefined;
        let brandColor: string | undefined;
        let defaultPrompt: string | undefined;

        try {
          const yamlUrl = `${rawBase}/${entry.category}/${entry.name}/agents/openai.yaml`;
          const yamlContent = await httpsGet(yamlUrl);
          const parsed = this.parseSimpleYaml(yamlContent);
          displayName = parsed['display_name'] || fallbackName;
          description = parsed['short_description'] || '';
          defaultPrompt = parsed['default_prompt'];
          brandColor = parsed['brand_color'];

          // Resolve icon URL from relative path
          const iconPath = parsed['icon_small'] || parsed['icon_large'];
          if (iconPath) {
            const cleanPath = iconPath.replace(/^\.\//, '');
            iconUrl = `${rawBase}/${entry.category}/${entry.name}/${cleanPath}`;
          }
        } catch {
          // No openai.yaml — use fallback
        }

        // If still no description, try fetching SKILL.md frontmatter
        if (!description) {
          try {
            const mdUrl = `${rawBase}/${entry.category}/${entry.name}/SKILL.md`;
            const md = await httpsGet(mdUrl);
            const { frontmatter: fm } = parseFrontmatter(md);
            if (fm.description) description = fm.description;
          } catch {
            // Use empty string
          }
        }

        if (!description) {
          description = `${entry.name.replace(/-/g, ' ')}`;
        }

        const skill: CatalogSkill = {
          id: entry.name,
          displayName,
          description,
          source: 'openai',
          sourceUrl: entry.html_url,
          iconUrl,
          brandColor: brandColor || '#10a37f',
          defaultPrompt,
          frontmatter: { name: entry.name, description },
          installed: false,
        };
        return skill;
      })
    );

    return skills;
  }

  private async fetchAnthropicCatalog(): Promise<CatalogSkill[]> {
    const url = 'https://api.github.com/repos/anthropics/skills/contents/skills';
    const rawBase = 'https://raw.githubusercontent.com/anthropics/skills/main/skills';
    const data = await httpsGet(url);
    const entries = JSON.parse(data) as Array<{ name: string; type: string; html_url?: string }>;
    const skills: CatalogSkill[] = [];

    for (const entry of entries) {
      if (entry.type !== 'dir') continue;
      const fallbackName = entry.name
        .split('-')
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');

      let description = '';

      // Try to get description from SKILL.md frontmatter
      try {
        const mdUrl = `${rawBase}/${entry.name}/SKILL.md`;
        const md = await httpsGet(mdUrl);
        const { frontmatter: fm } = parseFrontmatter(md);
        if (fm.description) description = fm.description;
      } catch {
        // Use fallback
      }

      if (!description) {
        description = `${entry.name.replace(/-/g, ' ')}`;
      }

      skills.push({
        id: entry.name,
        displayName: fallbackName,
        description,
        source: 'anthropic',
        sourceUrl: entry.html_url,
        brandColor: '#d4a574',
        frontmatter: { name: entry.name, description },
        installed: false,
      });
    }

    return skills;
  }

  /** Minimal YAML parser for openai.yaml interface block */
  private parseSimpleYaml(content: string): Record<string, string> {
    const result: Record<string, string> = {};
    for (const line of content.split('\n')) {
      const match = line.match(/^\s+(\w+):\s*"?([^"]*)"?\s*$/);
      if (match) {
        result[match[1]] = match[2].trim();
      }
    }
    return result;
  }
}

export const skillsService = new SkillsService();
