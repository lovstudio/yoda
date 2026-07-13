import * as fs from 'node:fs';
import * as https from 'node:https';
import * as os from 'node:os';
import * as path from 'node:path';
import type { RuntimeId } from '@shared/runtime-registry';
import { agentTargets, skillScanPaths } from '@shared/skills/agentTargets';
import { skillFamilyKey } from '@shared/skills/grouping';
import type {
  CatalogIndex,
  CatalogSkill,
  DetectedAgent,
  SkillCatalogSource,
  SkillFileSnapshot,
  SkillScope,
  SkillSelectionInput,
  SkillSessionPolicy,
} from '@shared/skills/types';
import {
  generateSkillMd,
  isValidSkillName,
  parseFrontmatter,
  validateSkillFrontmatter,
} from '@shared/skills/validation';
import { log } from '@main/lib/logger';
import bundledCatalog from './bundled-catalog.json';
import {
  auditSkillDirectory,
  downloadGitHubSkillDirectory,
  makeSkillKey,
  readManagedSkillManifest,
  readSkillDirectoryFiles,
  writeManagedSkillManifest,
} from './skill-assets';

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
  path.join('.agents', 'skills'),
  path.join('.agentskills'),
];

const MAX_REDIRECTS = 5;
const PLUGIN_SCAN_ROOTS = [
  path.join(os.homedir(), '.claude', 'plugins'),
  path.join(os.homedir(), '.codex', 'plugins'),
];
const MAX_PLUGIN_SCAN_DEPTH = 7;

const TARGET_RUNTIME_IDS: Partial<Record<string, RuntimeId>> = {
  'claude-code': 'claude',
  codex: 'codex',
  opencode: 'opencode',
  cursor: 'cursor',
  gemini: 'gemini',
  'mistral-vibe': 'mistral',
};

type ScanDirectory = {
  directory: string;
  runtimeId?: RuntimeId;
  projectRoot?: string;
  pluginScoped?: boolean;
};

/** Point the frontmatter `name:` field at the fork's new name, adding it if absent. */
function renameSkillFrontmatter(content: string, newName: string): string {
  return content.replace(/^---\r?\n([\s\S]*?)(\r?\n---)/, (_match, block: string, tail: string) => {
    const renamed = /^name:/m.test(block)
      ? block.replace(/^name:.*$/m, `name: ${newName}`)
      : `name: ${newName}\n${block}`;
    return `---\n${renamed}${tail}`;
  });
}

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
  private static readonly CATALOG_VERSION = 4;
  private static readonly INSTALLED_STATE_CACHE_MS = 2_000;
  private catalogCache: CatalogIndex | null = null;
  private installedStateCache = new Map<
    string,
    { catalog: CatalogIndex; expiresAt: number; value: CatalogIndex }
  >();

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
  private projectSkillDirs(projectPath?: string): ScanDirectory[] {
    if (!projectPath) return [];
    return PROJECT_SKILL_SUBDIRS.map((subdir) => ({
      directory: path.join(projectPath, subdir),
      projectRoot: projectPath,
      runtimeId: subdir.startsWith('.claude')
        ? 'claude'
        : subdir.startsWith('.codex')
          ? 'codex'
          : undefined,
    }));
  }

  async refreshCatalog(): Promise<CatalogIndex> {
    try {
      const [openaiSkills, anthropicSkills, lovstudioGeneral, lovstudioDev] =
        await Promise.allSettled([
          this.fetchOpenAICatalog(),
          this.fetchAnthropicCatalog(),
          this.fetchGitHubCatalog({
            owner: 'lovstudio',
            repo: 'general-skills',
            source: 'lovstudio-general',
            brandColor: '#d97706',
          }),
          this.fetchGitHubCatalog({
            owner: 'lovstudio',
            repo: 'dev-skills',
            source: 'lovstudio-dev',
            brandColor: '#2563eb',
          }),
        ]);

      const allSkills: CatalogSkill[] = [];
      if (openaiSkills.status === 'fulfilled') {
        allSkills.push(...openaiSkills.value);
      }
      if (anthropicSkills.status === 'fulfilled') {
        allSkills.push(...anthropicSkills.value);
      }
      if (lovstudioGeneral.status === 'fulfilled') allSkills.push(...lovstudioGeneral.value);
      if (lovstudioDev.status === 'fulfilled') allSkills.push(...lovstudioDev.value);

      // Catalog identity is source + locator. Same-name variants remain visible.
      const skills = Array.from(new Map(allSkills.map((skill) => [skill.key, skill])).values());

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
      this.installedStateCache.clear();
      await fs.promises.writeFile(CATALOG_INDEX_PATH, JSON.stringify(catalog, null, 2));
      return this.mergeInstalledState(catalog);
    } catch (error) {
      log.error('Failed to refresh catalog:', error);
      return this.getCatalogIndex();
    }
  }

  async getInstalledSkills(extraDirs: ScanDirectory[] = []): Promise<CatalogSkill[]> {
    await this.initialize();
    const pluginSkillDirs = await this.findPluginSkillDirectories();
    const targetDirectories = agentTargets.map((target) => ({
      directory: path.dirname(target.getSkillDir('_placeholder')),
      runtimeId: TARGET_RUNTIME_IDS[target.id],
    }));
    const targetPaths = new Set(targetDirectories.map((entry) => entry.directory));
    const dirsToScan: ScanDirectory[] = [
      { directory: SKILLS_ROOT },
      ...targetDirectories,
      ...skillScanPaths
        .filter((directory) => !targetPaths.has(directory))
        .map((directory) => ({ directory })),
      ...extraDirs,
      ...pluginSkillDirs,
    ];
    const discovered = new Map<
      string,
      {
        id: string;
        skillDir: string;
        disabled: boolean;
        runtimeIds: Set<RuntimeId>;
        projectScoped: boolean;
        pluginScoped: boolean;
      }
    >();

    for (const scan of dirsToScan) {
      let entries: fs.Dirent[];
      try {
        entries = await fs.promises.readdir(scan.directory, { withFileTypes: true });
      } catch {
        continue; // Directory doesn't exist
      }

      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue;
        if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;

        const discoveredPath = path.join(scan.directory, entry.name);
        let skillDir = discoveredPath;

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
            log.warn(
              `Skipping skill "${entry.name}" in ${scan.directory}: failed to resolve path`,
              err
            );
          }
          continue;
        }

        const localSkill = await this.readLocalSkill(skillDir);
        if (!localSkill) continue;
        const existing = discovered.get(skillDir);
        const isProjectScoped = Boolean(
          scan.projectRoot && isPathInside(scan.projectRoot, skillDir)
        );
        if (existing) {
          if (scan.runtimeId) existing.runtimeIds.add(scan.runtimeId);
          existing.projectScoped ||= isProjectScoped;
          existing.pluginScoped ||= scan.pluginScoped ?? false;
          continue;
        }
        discovered.set(skillDir, {
          id: entry.name,
          skillDir,
          disabled: localSkill.disabled,
          runtimeIds: new Set(scan.runtimeId ? [scan.runtimeId] : []),
          projectScoped: isProjectScoped,
          pluginScoped: scan.pluginScoped ?? false,
        });
      }
    }

    return Promise.all(
      Array.from(discovered.values(), async (entry) => {
        const localSkill = await this.readLocalSkill(entry.skillDir);
        if (!localSkill) throw new Error(`Skill disappeared while scanning: ${entry.skillDir}`);
        const manifest = await readManagedSkillManifest(entry.skillDir);
        // Direct children of ~/.agentskills are Yoda's managed namespace. A manifest
        // links catalog provenance; legacy/local Yoda skills remain manageable without one.
        const managed = this.isYodaManagedSkillPath(entry.skillDir);
        const scope: Exclude<SkillScope, 'catalog'> = managed
          ? 'managed'
          : entry.pluginScoped ||
              entry.skillDir.includes(`${path.sep}.claude${path.sep}plugins${path.sep}`) ||
              entry.skillDir.includes(`${path.sep}.codex${path.sep}plugins${path.sep}`)
            ? 'plugin'
            : entry.projectScoped
              ? 'project'
              : 'user';
        return this.buildLocalSkill(entry.id, entry.skillDir, localSkill.content, {
          disabled: entry.disabled,
          managed,
          scope,
          runtimeIds: Array.from(entry.runtimeIds),
          sourceKey: manifest?.sourceKey,
          reviewedContentHash: manifest?.reviewedContentHash,
        });
      })
    );
  }

  private async findPluginSkillDirectories(): Promise<ScanDirectory[]> {
    const found = new Set<string>();
    const visit = async (directory: string, depth: number): Promise<void> => {
      if (depth > MAX_PLUGIN_SCAN_DEPTH) return;
      let entries: fs.Dirent[];
      try {
        entries = await fs.promises.readdir(directory, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name === '.git' || entry.name === 'node_modules')
          continue;
        const child = path.join(directory, entry.name);
        if (entry.name === 'skills') {
          found.add(child);
          continue;
        }
        await visit(child, depth + 1);
      }
    };
    await Promise.all(PLUGIN_SCAN_ROOTS.map((root) => visit(root, 0)));
    return Array.from(found, (directory) => ({ directory, pluginScoped: true }));
  }

  async getSkillDetail(skillKey: string): Promise<CatalogSkill | null> {
    const catalog = await this.getCatalogIndex();
    const skill = this.findSkill(catalog.skills, skillKey);
    if (!skill) return null;

    // If installed, load the full SKILL.md from disk
    if (skill.installed && skill.localPath) {
      try {
        const localSkill = await this.readLocalSkill(skill.localPath);
        if (!localSkill) return skill;
        const manifest = await readManagedSkillManifest(skill.localPath);
        return this.mergeCatalogSkillWithLocal(
          skill,
          await this.buildLocalSkill(skill.id, skill.localPath, localSkill.content, {
            disabled: localSkill.disabled,
            managed: skill.managed,
            scope: skill.scope === 'catalog' ? 'user' : skill.scope,
            runtimeIds: skill.installation?.runtimeIds ?? [],
            sourceKey: skill.key,
            reviewedContentHash: manifest?.reviewedContentHash,
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
    if (skill.sourceUrl) {
      // e.g. https://github.com/openai/skills/tree/main/skills/.curated/linear
      // → https://raw.githubusercontent.com/openai/skills/main/skills/.curated/linear/SKILL.md
      const match = skill.sourceUrl.match(/github\.com\/([^/]+\/[^/]+)\/tree\/main\/(.+)/);
      if (match) {
        return `https://raw.githubusercontent.com/${match[1]}/main/${match[2]}/SKILL.md`;
      }
    }
    return null;
  }

  async installSkill(skillKey: string): Promise<CatalogSkill> {
    await this.initialize();
    const catalog = await this.getCatalogIndex();
    const skill = this.findSkill(catalog.skills, skillKey);
    if (!skill) throw new Error(`Skill "${skillKey}" not found in catalog`);
    if (skill.installed) throw new Error(`Skill "${skill.displayName}" is already installed`);
    if (!skill.sourceUrl) throw new Error(`Skill "${skill.displayName}" has no installable source`);

    const skillDir = path.join(SKILLS_ROOT, skill.id);
    const tmpDir = `${skillDir}.tmp-${Date.now()}`;
    try {
      try {
        await fs.promises.lstat(skillDir);
        throw new Error(
          `Cannot install "${skill.displayName}": ${skillDir} already exists. Resolve the same-name skill first.`
        );
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      await fs.promises.mkdir(tmpDir, { recursive: true });
      await downloadGitHubSkillDirectory(skill.sourceUrl, tmpDir);
      const content = await fs.promises.readFile(path.join(tmpDir, SKILL_MD_FILENAME), 'utf8');
      const parsed = parseFrontmatter(content);
      const validationIssues = validateSkillFrontmatter(parsed.frontmatter, {
        skillFilePath: path.join(skillDir, SKILL_MD_FILENAME),
        hasFrontmatter: parsed.hasFrontmatter,
        unknownFields: parsed.unknownFields,
      });
      if (validationIssues.some((issue) => issue.severity === 'error')) {
        throw new Error(
          `Skill package is invalid: ${validationIssues
            .filter((issue) => issue.severity === 'error')
            .map((issue) => issue.message)
            .join('; ')}`
        );
      }
      const audit = await auditSkillDirectory(tmpDir, parsed.frontmatter);
      await writeManagedSkillManifest(tmpDir, {
        schemaVersion: 1,
        sourceKey: skill.key,
        sourceUrl: skill.sourceUrl,
        installedAt: new Date().toISOString(),
      });

      // Atomic move: rename tmp dir to final location
      await fs.promises.rename(tmpDir, skillDir);

      // Sync to agents
      await this.syncToAgents(skill.id);

      // Invalidate cache
      this.invalidateCaches();

      return {
        ...skill,
        installed: true,
        disabled: false,
        localPath: skillDir,
        skillMdContent: content,
        managed: true,
        scope: 'managed',
        contentHash: audit.contentHash,
        installation: {
          path: skillDir,
          managed: true,
          scope: 'managed',
          runtimeIds: [],
          contentHash: audit.contentHash,
          fileCount: audit.fileCount,
          totalBytes: audit.totalBytes,
          sourceKey: skill.key,
        },
        dependencies: audit.dependencies,
        riskLevel: audit.riskLevel,
        healthIssues: audit.healthIssues,
      };
    } catch (error) {
      // Clean up partial install
      await fs.promises.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
      throw error;
    }
  }

  async uninstallSkill(skillKey: string): Promise<void> {
    const catalog = await this.getCatalogIndex();
    const skill = this.findSkill(catalog.skills, skillKey);
    if (!skill?.installed || !skill.localPath) {
      throw new Error(`Skill "${skillKey}" is not installed`);
    }
    if (!skill.managed || !this.isYodaManagedSkillPath(skill.localPath)) {
      throw new Error(
        `Yoda does not own this external installation. Remove it from ${skill.localPath}.`
      );
    }
    const skillDir = skill.localPath;

    // Remove agent symlinks first
    await this.unsyncFromAgents(skill.id);

    // Remove skill directory
    try {
      await fs.promises.rm(skillDir, { recursive: true, force: true });
    } catch (error) {
      log.error(`Failed to remove skill directory ${skillDir}:`, error);
      throw error;
    }

    // Invalidate cache
    this.invalidateCaches();
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
    const key = makeSkillKey('local', name, skillDir);
    const { frontmatter } = parseFrontmatter(skillContent);
    const audit = await auditSkillDirectory(skillDir, frontmatter);
    await writeManagedSkillManifest(skillDir, {
      schemaVersion: 1,
      sourceKey: key,
      sourceUrl: `file://${skillDir}`,
      installedAt: new Date().toISOString(),
      reviewedContentHash: audit.contentHash,
    });

    // Sync to agents
    await this.syncToAgents(name);

    // Invalidate cache
    this.invalidateCaches();

    return this.buildLocalSkill(name, skillDir, skillContent, {
      managed: true,
      scope: 'managed',
      runtimeIds: [],
      sourceKey: key,
      reviewedContentHash: audit.contentHash,
    });
  }

  /** Overwrite an installed skill's SKILL.md (works on disabled skills too). */
  async updateSkillContent(skillKey: string, content: string): Promise<CatalogSkill> {
    await this.initialize();
    const catalog = await this.getCatalogIndex();
    const skill = this.findSkill(catalog.skills, skillKey);
    if (!skill) throw new Error(`Skill "${skillKey}" not found in catalog`);
    if (!skill.installed || !skill.localPath) {
      throw new Error(`Skill "${skill.displayName}" is not installed`);
    }
    if (skill.scope === 'plugin') {
      throw new Error(
        'Plugin skill files are owned by the plugin. Fork the skill before editing it.'
      );
    }

    const fileName = skill.disabled ? DISABLED_SKILL_MD_FILENAME : SKILL_MD_FILENAME;
    await fs.promises.writeFile(path.join(skill.localPath, fileName), content);

    this.invalidateCaches();
    const updated = await this.getSkillDetail(skill.key);
    if (!updated) throw new Error(`Skill "${skill.displayName}" not found after update`);
    return updated;
  }

  /**
   * Fork an installed skill: copy its whole directory (references/, scripts/,
   * assets/ included) into the global skills root under a new name.
   */
  async duplicateSkill(skillKey: string, newName: string): Promise<CatalogSkill> {
    if (!isValidSkillName(newName)) {
      throw new Error(
        'Invalid skill name. Use lowercase letters, numbers, and hyphens (1-64 chars).'
      );
    }

    await this.initialize();
    const catalog = await this.getCatalogIndex();
    const skill = this.findSkill(catalog.skills, skillKey);
    if (!skill) throw new Error(`Skill "${skillKey}" not found in catalog`);
    if (!skill.installed || !skill.localPath) {
      throw new Error(`Skill "${skill.displayName}" is not installed`);
    }
    if (catalog.skills.some((s) => s.id === newName)) {
      throw new Error(`Skill "${newName}" already exists`);
    }

    const targetDir = path.join(SKILLS_ROOT, newName);
    try {
      await fs.promises.access(targetDir);
      throw new Error(`Skill "${newName}" already exists`);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }

    try {
      await fs.promises.cp(skill.localPath, targetDir, { recursive: true });

      // A disabled source stays runnable in the fork.
      const disabledMd = path.join(targetDir, DISABLED_SKILL_MD_FILENAME);
      const activeMd = path.join(targetDir, SKILL_MD_FILENAME);
      try {
        await fs.promises.access(disabledMd);
        await fs.promises.rename(disabledMd, activeMd);
      } catch {
        // No disabled file — normal case
      }

      const content = await fs.promises.readFile(activeMd, 'utf-8');
      await fs.promises.writeFile(activeMd, renameSkillFrontmatter(content, newName));

      const forkKey = makeSkillKey('local', newName, targetDir);
      const parsed = parseFrontmatter(await fs.promises.readFile(activeMd, 'utf8'));
      const audit = await auditSkillDirectory(targetDir, parsed.frontmatter);
      await writeManagedSkillManifest(targetDir, {
        schemaVersion: 1,
        sourceKey: forkKey,
        sourceUrl: `file://${targetDir}`,
        installedAt: new Date().toISOString(),
        reviewedContentHash: audit.contentHash,
      });

      await this.syncToAgents(newName);
    } catch (error) {
      await fs.promises.rm(targetDir, { recursive: true, force: true }).catch(() => {});
      throw error;
    }

    this.invalidateCaches();
    const created = await this.getSkillDetail(makeSkillKey('local', newName, targetDir));
    if (!created) throw new Error(`Skill "${newName}" not found after duplication`);
    return created;
  }

  async setSkillDisabled(skillKey: string, disabled: boolean): Promise<CatalogSkill> {
    await this.initialize();
    const catalog = await this.getCatalogIndex();
    const skill = this.findSkill(catalog.skills, skillKey);
    if (!skill) throw new Error(`Skill "${skillKey}" not found in catalog`);
    if (!skill.installed || !skill.localPath) {
      throw new Error(`Skill "${skill.displayName}" is not installed`);
    }
    if (skill.scope === 'plugin') {
      throw new Error('Plugin skills are enabled or disabled through their plugin.');
    }

    const activePath = path.join(skill.localPath, SKILL_MD_FILENAME);
    const disabledPath = path.join(skill.localPath, DISABLED_SKILL_MD_FILENAME);

    if (disabled) {
      if (!skill.disabled) {
        await this.assertMissingFile(disabledPath, 'disabled skill file');
        await fs.promises.rename(activePath, disabledPath);
      }
      await this.unsyncFromAgents(skill.id);
    } else {
      if (skill.disabled) {
        await this.assertMissingFile(activePath, 'active skill file');
        await fs.promises.rename(disabledPath, activePath);
      }
      if (this.isYodaManagedSkillPath(skill.localPath)) {
        await this.syncToAgents(skill.id);
      }
    }

    this.invalidateCaches();
    const updated = await this.getSkillDetail(skill.key);
    if (!updated) throw new Error(`Skill "${skill.displayName}" not found after update`);
    return updated;
  }

  async syncToAgents(skillId: string): Promise<void> {
    const skillDir = path.join(SKILLS_ROOT, skillId);
    for (const target of agentTargets) {
      try {
        // Only sync if the agent's config dir exists (agent is installed)
        await fs.promises.access(target.configDir);
        for (const legacyDir of target.getLegacySkillDirs?.(skillId) ?? []) {
          await this.removeOwnedSkillSymlink(legacyDir);
        }
        const targetDir = target.getSkillDir(skillId);
        const parentDir = path.dirname(targetDir);
        await fs.promises.mkdir(parentDir, { recursive: true });

        // Replace only links Yoda already owns. Never overwrite a real directory
        // or an unrelated symlink in a runtime's config.
        try {
          const stat = await fs.promises.lstat(targetDir);
          if (!stat.isSymbolicLink()) {
            log.warn(`Skipping skill sync: user-managed path already exists at ${targetDir}`);
            continue;
          }
          const linkTarget = await fs.promises.readlink(targetDir);
          const resolved = path.resolve(path.dirname(targetDir), linkTarget);
          if (!isPathInside(SKILLS_ROOT, resolved)) {
            log.warn(`Skipping skill sync: unrelated symlink already exists at ${targetDir}`);
            continue;
          }
          await fs.promises.unlink(targetDir);
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
      for (const targetDir of [
        target.getSkillDir(skillId),
        ...(target.getLegacySkillDirs?.(skillId) ?? []),
      ]) {
        await this.removeOwnedSkillSymlink(targetDir);
      }
    }
  }

  private async removeOwnedSkillSymlink(targetDir: string): Promise<void> {
    try {
      const stat = await fs.promises.lstat(targetDir);
      if (!stat.isSymbolicLink()) return;
      const linkTarget = await fs.promises.readlink(targetDir);
      const resolved = path.resolve(path.dirname(targetDir), linkTarget);
      if (isPathInside(SKILLS_ROOT, resolved)) await fs.promises.unlink(targetDir);
    } catch {
      // Missing or user-inaccessible paths are left untouched.
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

  async getSkillFiles(skillKey: string): Promise<SkillFileSnapshot[]> {
    const catalog = await this.getCatalogIndex();
    const skill = this.findSkill(catalog.skills, skillKey);
    if (!skill) throw new Error(`Skill "${skillKey}" not found`);
    if (skill.installed && skill.localPath) return readSkillDirectoryFiles(skill.localPath);
    if (!skill.sourceUrl) return [];

    const temporaryRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'yoda-skill-'));
    try {
      await downloadGitHubSkillDirectory(skill.sourceUrl, temporaryRoot);
      return await readSkillDirectoryFiles(temporaryRoot);
    } finally {
      await fs.promises.rm(temporaryRoot, { recursive: true, force: true }).catch(() => {});
    }
  }

  async resolveSessionPolicy(
    selection: SkillSelectionInput,
    projectPath?: string,
    runtimeId?: RuntimeId
  ): Promise<SkillSessionPolicy> {
    const catalog = await this.getCatalogIndex(projectPath);
    const availableSkills = catalog.skills.filter(
      (skill) => skill.installed && !skill.disabled && skill.localPath && skill.contentHash
    );
    const warnings: string[] = [];
    const requested = new Map<string, 'auto' | 'manual'>();
    for (const identifier of selection.manualSkillKeys) requested.set(identifier, 'manual');
    for (const identifier of selection.autoSkillKeys) requested.set(identifier, 'auto');

    const entries = Array.from(requested, ([identifier, mode]) => {
      const skill = this.findSkill(availableSkills, identifier);
      if (!skill?.localPath || !skill.contentHash || skill.scope === 'catalog') {
        warnings.push(`Configured skill is unavailable: ${identifier}`);
        return null;
      }
      if (skill.scope === 'plugin') {
        warnings.push(`Plugin skill ${skill.id} is controlled by its plugin at runtime.`);
      }
      return {
        key: skill.key,
        id: skill.id,
        path: skill.localPath,
        contentHash: skill.contentHash,
        mode,
        scope: skill.scope,
      };
    }).filter((entry): entry is NonNullable<typeof entry> => entry !== null);

    const duplicateNames = new Set<string>();
    for (const entry of entries) {
      const selectedSkill = availableSkills.find((candidate) => candidate.key === entry.key);
      if (!selectedSkill) continue;
      if (
        availableSkills.some(
          (candidate) =>
            candidate.key !== entry.key &&
            skillFamilyKey(candidate) === skillFamilyKey(selectedSkill)
        )
      ) {
        duplicateNames.add(selectedSkill.frontmatter.name || entry.id);
      }
    }
    if (runtimeId !== 'codex') {
      for (const name of duplicateNames) {
        warnings.push(
          `Multiple available skills use "${name}"; name-based runtimes may not load the selected variant.`
        );
      }
    }
    if (runtimeId && runtimeId !== 'claude' && runtimeId !== 'codex') {
      warnings.push(`${runtimeId} does not support per-session skill isolation in Yoda yet.`);
    }
    if (availableSkills.some((skill) => skill.scope === 'plugin')) {
      warnings.push('Plugin skills remain controlled by their plugin outside the Agent profile.');
    }
    if (runtimeId === 'codex' && entries.some((entry) => entry.mode === 'manual')) {
      warnings.push(
        'Codex can isolate skill paths per session, but manual-only invocation still depends on the skill metadata.'
      );
    }

    return {
      source: 'agent-profile',
      entries,
      available: availableSkills.flatMap((skill) =>
        skill.localPath && skill.scope !== 'catalog'
          ? [{ key: skill.key, id: skill.id, path: skill.localPath, scope: skill.scope }]
          : []
      ),
      warnings,
      createdAt: new Date().toISOString(),
    };
  }

  async markSkillReviewed(skillKey: string): Promise<CatalogSkill> {
    const catalog = await this.getCatalogIndex();
    const skill = this.findSkill(catalog.skills, skillKey);
    if (!skill?.installed || !skill.localPath || !skill.managed) {
      throw new Error('Only Yoda-managed skills can be marked as reviewed.');
    }
    const manifest = await readManagedSkillManifest(skill.localPath);
    const audit = await auditSkillDirectory(skill.localPath, skill.frontmatter);
    await writeManagedSkillManifest(skill.localPath, {
      schemaVersion: 1,
      sourceKey: manifest?.sourceKey ?? skill.key,
      sourceUrl: manifest?.sourceUrl ?? skill.sourceUrl ?? `file://${skill.localPath}`,
      installedAt: manifest?.installedAt ?? new Date().toISOString(),
      reviewedContentHash: audit.contentHash,
    });
    this.invalidateCaches();
    const updated = await this.getSkillDetail(skill.key);
    if (!updated) throw new Error('Skill disappeared after review update.');
    return updated;
  }

  // --- Private helpers ---

  private invalidateCaches(): void {
    this.catalogCache = null;
    this.installedStateCache.clear();
  }

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
    const raw = bundledCatalog as Omit<CatalogIndex, 'skills'> & {
      skills: Array<Partial<CatalogSkill> & Pick<CatalogSkill, 'id' | 'source'>>;
    };
    return {
      ...raw,
      version: SkillsService.CATALOG_VERSION,
      skills: raw.skills.map((skill) => this.hydrateCatalogSkill(skill)),
    };
  }

  private async mergeInstalledState(
    catalog: CatalogIndex,
    projectPath?: string
  ): Promise<CatalogIndex> {
    const cacheKey = projectPath ? path.resolve(projectPath) : '<global>';
    const cached = this.installedStateCache.get(cacheKey);
    if (cached && cached.catalog === catalog && cached.expiresAt > Date.now()) {
      return cached.value;
    }
    const installed = await this.getInstalledSkills(this.projectSkillDirs(projectPath));
    const catalogSkills = catalog.skills.map((skill) => this.hydrateCatalogSkill(skill));
    const consumedLocalKeys = new Set<string>();
    const catalogNameCounts = new Map<string, number>();
    for (const skill of catalogSkills) {
      catalogNameCounts.set(skill.id, (catalogNameCounts.get(skill.id) ?? 0) + 1);
    }

    const mergedSkills = catalogSkills.map((skill) => {
      const local = installed.find(
        (candidate) =>
          !consumedLocalKeys.has(candidate.key) &&
          (candidate.installation?.sourceKey === skill.key ||
            (candidate.managed &&
              !candidate.installation?.sourceKey &&
              candidate.id === skill.id &&
              catalogNameCounts.get(skill.id) === 1))
      );
      if (local) {
        consumedLocalKeys.add(local.key);
        return this.mergeCatalogSkillWithLocal(skill, local);
      }
      return {
        ...skill,
        installed: false,
        disabled: false,
        managed: false,
        scope: 'catalog' as const,
      };
    });

    for (const local of installed) {
      if (!consumedLocalKeys.has(local.key)) mergedSkills.push(local);
    }

    const value = {
      ...catalog,
      version: SkillsService.CATALOG_VERSION,
      skills: this.annotateConflicts(mergedSkills),
    };
    this.installedStateCache.set(cacheKey, {
      catalog,
      expiresAt: Date.now() + SkillsService.INSTALLED_STATE_CACHE_MS,
      value,
    });
    return value;
  }

  private async buildLocalSkill(
    id: string,
    skillDir: string,
    content: string,
    options: {
      disabled?: boolean;
      managed: boolean;
      scope: Exclude<SkillScope, 'catalog'>;
      runtimeIds: RuntimeId[];
      sourceKey?: string;
      reviewedContentHash?: string;
    }
  ): Promise<CatalogSkill> {
    const { frontmatter, hasFrontmatter, unknownFields } = parseFrontmatter(content);
    const skillFilePath = path.join(skillDir, 'SKILL.md');
    const validationIssues = validateSkillFrontmatter(frontmatter, {
      skillFilePath,
      hasFrontmatter,
      unknownFields,
    });
    const audit = await auditSkillDirectory(skillDir, frontmatter);
    const key = makeSkillKey('local', id, skillDir);
    const healthIssues = [...audit.healthIssues];
    if (!options.managed) {
      healthIssues.push({
        severity: 'info',
        code: 'external-install',
        message: 'This installation is managed outside Yoda and cannot be uninstalled here.',
      });
    }
    if (options.scope === 'plugin') {
      healthIssues.push({
        severity: 'info',
        code: 'runtime-isolation-limited',
        message: 'Plugin skills are controlled by their plugin and cannot be isolated per session.',
      });
    }
    if (options.managed && !options.reviewedContentHash) {
      healthIssues.push({
        severity: 'warning',
        code: 'unreviewed',
        message: 'This managed skill has not been reviewed in Yoda yet.',
      });
    }
    if (validationIssues.length > 0) {
      healthIssues.push({
        severity: validationIssues.some((issue) => issue.severity === 'error')
          ? 'error'
          : 'warning',
        code: 'validation',
        message: `${validationIssues.length} format validation issue${validationIssues.length === 1 ? '' : 's'}`,
      });
    }
    if (options.reviewedContentHash && options.reviewedContentHash !== audit.contentHash) {
      healthIssues.push({
        severity: 'warning',
        code: 'content-changed',
        message: 'Skill files changed since the last reviewed version.',
      });
    }
    const variantMatch = id.match(/-(standard|basic|lite|pro|advanced)$/i);

    return {
      key,
      ref: {
        key,
        id,
        source: 'local',
        locator: skillDir,
        version: frontmatter.metadata?.version,
        contentHash: audit.contentHash,
      },
      id,
      displayName: frontmatter.name || id,
      description: frontmatter.description || '',
      source: 'local',
      scope: options.scope,
      managed: options.managed,
      frontmatter,
      validationIssues,
      installed: true,
      disabled: options.disabled ?? false,
      localPath: skillDir,
      skillMdContent: content,
      contentHash: audit.contentHash,
      workflowId: variantMatch ? id.slice(0, -variantMatch[0].length) : id,
      variant: variantMatch?.[1]?.toLocaleLowerCase(),
      version: frontmatter.metadata?.version,
      dependencies: audit.dependencies,
      riskLevel: audit.riskLevel,
      healthIssues,
      installation: {
        path: skillDir,
        managed: options.managed,
        scope: options.scope,
        runtimeIds: options.runtimeIds,
        contentHash: audit.contentHash,
        fileCount: audit.fileCount,
        totalBytes: audit.totalBytes,
        sourceKey: options.sourceKey,
      },
    };
  }

  private mergeCatalogSkillWithLocal(
    catalogSkill: CatalogSkill,
    local: CatalogSkill
  ): CatalogSkill {
    return {
      ...catalogSkill,
      ref: { ...catalogSkill.ref, contentHash: local.contentHash },
      displayName: local.displayName || catalogSkill.displayName,
      description: local.description || catalogSkill.description,
      frontmatter: local.frontmatter,
      validationIssues: local.validationIssues,
      installed: true,
      disabled: local.disabled ?? false,
      localPath: local.localPath,
      skillMdContent: local.skillMdContent,
      managed: local.managed,
      scope: local.scope,
      installation: {
        ...local.installation!,
        sourceKey: catalogSkill.key,
      },
      contentHash: local.contentHash,
      dependencies: local.dependencies,
      riskLevel: local.riskLevel,
      healthIssues: local.healthIssues,
    };
  }

  private hydrateCatalogSkill(
    skill: Partial<CatalogSkill> & Pick<CatalogSkill, 'id' | 'source'>
  ): CatalogSkill {
    const locator = skill.sourceUrl ?? skill.ref?.locator ?? `bundled:${skill.source}:${skill.id}`;
    const key = skill.key ?? makeSkillKey(skill.source, skill.id, locator);
    const description = skill.description ?? skill.frontmatter?.description ?? '';
    return {
      ...skill,
      key,
      ref: skill.ref ?? {
        key,
        id: skill.id,
        source: skill.source,
        locator,
        version: skill.version,
        contentHash: skill.contentHash,
      },
      id: skill.id,
      displayName: skill.displayName ?? skill.id,
      description,
      source: skill.source,
      scope: skill.installed ? (skill.scope ?? 'user') : 'catalog',
      managed: skill.managed ?? false,
      frontmatter: skill.frontmatter ?? { name: skill.id, description },
      installed: skill.installed ?? false,
    };
  }

  private annotateConflicts(skills: CatalogSkill[]): CatalogSkill[] {
    const byName = new Map<string, CatalogSkill[]>();
    for (const skill of skills) {
      const familyKey = skillFamilyKey(skill);
      const group = byName.get(familyKey) ?? [];
      group.push(skill);
      byName.set(familyKey, group);
    }
    return skills.map((skill) => {
      const runtimeName = skill.frontmatter.name || skill.id;
      const conflicts = (byName.get(skillFamilyKey(skill)) ?? []).filter(
        (candidate) => candidate.key !== skill.key
      );
      if (conflicts.length === 0) return skill;
      const installedConflicts = conflicts.filter((candidate) => candidate.installed);
      const hasDifferentInstalledContent = installedConflicts.some(
        (candidate) =>
          !skill.contentHash ||
          !candidate.contentHash ||
          candidate.contentHash !== skill.contentHash
      );
      const issue = {
        severity: hasDifferentInstalledContent ? ('warning' as const) : ('info' as const),
        code: hasDifferentInstalledContent
          ? ('runtime-name-conflict' as const)
          : installedConflicts.length > 0
            ? ('duplicate-installation' as const)
            : ('identity-conflict' as const),
        message: hasDifferentInstalledContent
          ? `Another installed skill uses the runtime name "${runtimeName}".`
          : installedConflicts.length > 0
            ? `The same skill content is installed in ${installedConflicts.length + 1} locations.`
            : `${conflicts.length + 1} catalog or local variants share the name "${runtimeName}".`,
        relatedSkillKeys: conflicts.map((candidate) => candidate.key),
      };
      return {
        ...skill,
        conflictKeys: conflicts.map((candidate) => candidate.key),
        healthIssues: [
          ...(skill.healthIssues ?? []).filter(
            (healthIssue) =>
              healthIssue.code !== 'identity-conflict' &&
              healthIssue.code !== 'runtime-name-conflict' &&
              healthIssue.code !== 'duplicate-installation'
          ),
          issue,
        ],
      };
    });
  }

  private findSkill(skills: CatalogSkill[], identifier: string): CatalogSkill | undefined {
    const exact = skills.find((skill) => skill.key === identifier);
    if (exact) return exact;
    return skills
      .filter((skill) => skill.id === identifier)
      .sort((left, right) => {
        if (left.installed !== right.installed) return left.installed ? -1 : 1;
        if (left.managed !== right.managed) return left.managed ? -1 : 1;
        return left.key.localeCompare(right.key);
      })[0];
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

        const skill = this.hydrateCatalogSkill({
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
        });
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

      skills.push(
        this.hydrateCatalogSkill({
          id: entry.name,
          displayName: fallbackName,
          description,
          source: 'anthropic',
          sourceUrl: entry.html_url,
          brandColor: '#d4a574',
          frontmatter: { name: entry.name, description },
          installed: false,
        })
      );
    }

    return skills;
  }

  private async fetchGitHubCatalog(args: {
    owner: string;
    repo: string;
    source: Extract<SkillCatalogSource, 'lovstudio-general' | 'lovstudio-dev'>;
    brandColor: string;
  }): Promise<CatalogSkill[]> {
    const url = `https://api.github.com/repos/${args.owner}/${args.repo}/contents/skills`;
    const rawBase = `https://raw.githubusercontent.com/${args.owner}/${args.repo}/main/skills`;
    const data = await httpsGet(url);
    const entries = JSON.parse(data) as Array<{ name: string; type: string; html_url?: string }>;
    const directories = entries.filter((entry) => entry.type === 'dir');
    return Promise.all(
      directories.map(async (entry) => {
        let description = entry.name.replace(/-/g, ' ');
        let displayName = entry.name;
        try {
          const content = await httpsGet(`${rawBase}/${entry.name}/SKILL.md`);
          const { frontmatter } = parseFrontmatter(content);
          description = frontmatter.description || description;
          displayName = frontmatter.name || displayName;
        } catch {
          // The catalog entry remains visible; detail/install will surface a package error.
        }
        return this.hydrateCatalogSkill({
          id: entry.name,
          displayName,
          description,
          source: args.source,
          sourceUrl:
            entry.html_url ??
            `https://github.com/${args.owner}/${args.repo}/tree/main/skills/${entry.name}`,
          brandColor: args.brandColor,
          frontmatter: { name: entry.name, description },
          installed: false,
        });
      })
    );
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
