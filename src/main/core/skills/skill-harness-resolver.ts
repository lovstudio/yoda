import path from 'node:path';
import {
  HARNESS_RUNTIMES,
  MAX_FLAT_MD_FILES,
  MAX_FRONTMATTER_BYTES,
  MAX_MEMORY_FILE_BYTES,
  MAX_SKILL_TREE_DEPTH,
  type HarnessFileStatus,
  type HarnessMcpServer,
  type HarnessMdEntry,
  type HarnessMemoryFile,
  type HarnessRuntimeData,
  type McpSourceSpec,
  type ResolvedHarnessSkill,
  type ResolvedHarnessSkillLocation,
  type ResolvedHarnessSnapshot,
  type RuntimeSurfaceSpec,
} from '@shared/harness';
import type { CatalogIndex, CatalogSkill } from '@shared/skills/types';
import type { FileSystemProvider } from '@main/core/fs/types';

type HarnessFileSystem = Pick<FileSystemProvider, 'list' | 'read' | 'realPath'>;

type DirectoryEntry = { path: string; type: 'file' | 'dir' };
type DirectoryListing = { exists: boolean; entries: DirectoryEntry[] };
type FileRead = { content: string; truncated: boolean; totalSize: number } | null;

export type ResolveHarnessSnapshotInput = {
  projectId: string;
  projectPath: string;
  projectType: 'local' | 'ssh';
  fileSystem: HarnessFileSystem;
  catalog?: CatalogIndex;
};

export async function resolveHarnessSnapshot(
  input: ResolveHarnessSnapshotInput
): Promise<ResolvedHarnessSnapshot> {
  const loader = new HarnessLoader(input);
  const runtimeEntries = await Promise.all(
    HARNESS_RUNTIMES.map(async (spec) => [spec.id, await loader.loadRuntime(spec)] as const)
  );

  return {
    projectId: input.projectId,
    projectPath: input.projectPath,
    projectType: input.projectType,
    generatedAt: new Date().toISOString(),
    runtimes: Object.fromEntries(runtimeEntries) as ResolvedHarnessSnapshot['runtimes'],
  };
}

/**
 * Resolves every project Harness surface through one main-process filesystem
 * snapshot. Catalog metadata remains owned by SkillsService; this resolver only
 * adds runtime-specific exposure paths and preserves every physical location.
 */
class HarnessLoader {
  private listings = new Map<string, Promise<DirectoryListing>>();
  private reads = new Map<string, Promise<FileRead>>();
  private realPaths = new Map<string, Promise<string | null>>();
  private catalogByPath: Map<string, CatalogSkill>;

  constructor(private input: ResolveHarnessSnapshotInput) {
    this.catalogByPath = new Map<string, CatalogSkill>();
    for (const skill of input.catalog?.skills ?? []) {
      if (!skill.installed || !skill.localPath) continue;
      this.catalogByPath.set(normalizePath(skill.localPath), skill);
    }
  }

  async loadRuntime(spec: RuntimeSurfaceSpec): Promise<HarnessRuntimeData> {
    const [memory, skills, commands, subagents, mcpServers, settingsFiles, skillDirs] =
      await Promise.all([
        this.loadMemoryFiles(spec.memoryFiles),
        this.loadSkills(spec.skillDirs),
        this.loadFlatMdEntries(spec.commandDirs),
        this.loadFlatMdEntries(spec.subagentDirs),
        this.loadMcpServers(spec.mcp),
        Promise.all(spec.settingsFiles.map((relativePath) => this.fileStatus(relativePath))),
        Promise.all(
          spec.skillDirs.map(async (relativePath) => ({
            relativePath,
            exists: (await this.listDir(relativePath)).exists,
          }))
        ),
      ]);

    return {
      memoryFiles: memory.found,
      missingMemoryFiles: memory.missing,
      skills,
      commands,
      subagents,
      mcpServers,
      settingsFiles,
      skillDirs,
    };
  }

  private async loadMemoryFiles(
    paths: string[]
  ): Promise<{ found: HarnessMemoryFile[]; missing: string[] }> {
    const found: HarnessMemoryFile[] = [];
    const missing: string[] = [];
    await Promise.all(
      paths.map(async (relativePath) => {
        const read = await this.readFile(relativePath, MAX_MEMORY_FILE_BYTES);
        if (read) found.push({ relativePath, ...read });
        else missing.push(relativePath);
      })
    );
    found.sort((a, b) => paths.indexOf(a.relativePath) - paths.indexOf(b.relativePath));
    missing.sort((a, b) => paths.indexOf(a) - paths.indexOf(b));
    return { found, missing };
  }

  private async loadSkills(dirs: string[]): Promise<ResolvedHarnessSkill[]> {
    const perDirectory = await Promise.all(
      dirs.map((directory) => this.scanSkillTree(directory, directory, '', 0))
    );
    const grouped = new Map<string, ResolvedHarnessSkill>();

    for (const skill of perDirectory.flat()) {
      const existing = grouped.get(skill.id);
      if (existing) {
        existing.locations.push(...skill.locations);
        continue;
      }
      grouped.set(skill.id, skill);
    }

    await Promise.all(
      Array.from(grouped.values(), async (skill) => {
        const catalogMatches = await Promise.all(
          skill.locations.map(async (location) => ({
            location,
            catalogSkill: await this.findCatalogSkill(location.path),
          }))
        );

        skill.locations = catalogMatches
          .map(({ location, catalogSkill }) => this.resolveLocation(location, catalogSkill))
          .sort((a, b) => a.path.localeCompare(b.path));
        const primaryCatalogSkill = catalogMatches.find(
          ({ catalogSkill }) => catalogSkill
        )?.catalogSkill;
        if (primaryCatalogSkill) {
          skill.displayName = primaryCatalogSkill.displayName || skill.displayName;
          skill.description = primaryCatalogSkill.description || skill.description;
        }
        skill.disabled = skill.locations.every((location) => location.disabled);
        skill.validationIssueCount = Math.max(
          0,
          ...skill.locations.map((location) => location.validationIssueCount)
        );
      })
    );

    return [...grouped.values()].sort((a, b) => a.id.localeCompare(b.id));
  }

  private async scanSkillTree(
    rootPath: string,
    directoryPath: string,
    namespace: string,
    depth: number
  ): Promise<ResolvedHarnessSkill[]> {
    if (depth > MAX_SKILL_TREE_DEPTH) return [];
    const listing = await this.listDir(directoryPath);
    if (!listing.exists) return [];

    const skillFile = listing.entries.find((entry) => {
      if (entry.type !== 'file') return false;
      const name = basename(entry.path);
      return name === 'SKILL.md' || name === 'SKILL.md.disabled';
    });
    const ownSkill: ResolvedHarnessSkill[] =
      skillFile && directoryPath !== rootPath
        ? [
            {
              id: namespace,
              displayName: namespace,
              description: '',
              disabled: skillFile.path.endsWith('.disabled'),
              validationIssueCount: 0,
              locations: [
                {
                  path: directoryPath,
                  disabled: skillFile.path.endsWith('.disabled'),
                  validationIssueCount: 0,
                },
              ],
            },
          ]
        : [];

    const children = await Promise.all(
      listing.entries
        .filter((entry) => entry.type === 'dir' && !basename(entry.path).startsWith('.'))
        .map((entry) =>
          this.scanSkillTree(
            rootPath,
            entry.path,
            namespace ? `${namespace}:${basename(entry.path)}` : basename(entry.path),
            depth + 1
          )
        )
    );
    return [...ownSkill, ...children.flat()];
  }

  private async findCatalogSkill(relativePath: string): Promise<CatalogSkill | undefined> {
    if (this.catalogByPath.size === 0) return undefined;
    const absolutePath = normalizePath(path.resolve(this.input.projectPath, relativePath));
    const directMatch = this.catalogByPath.get(absolutePath);
    if (directMatch) return directMatch;

    const realPath = await this.realPath(relativePath);
    return realPath ? this.catalogByPath.get(normalizePath(realPath)) : undefined;
  }

  private resolveLocation(
    location: ResolvedHarnessSkillLocation,
    catalogSkill: CatalogSkill | undefined
  ): ResolvedHarnessSkillLocation {
    if (!catalogSkill) return location;
    return {
      ...location,
      skillKey: catalogSkill.key,
      contentHash: catalogSkill.contentHash,
      scope: catalogSkill.scope,
      riskLevel: catalogSkill.riskLevel,
      disabled: location.disabled || catalogSkill.disabled === true,
      validationIssueCount: catalogSkill.validationIssues?.length ?? 0,
    };
  }

  private async loadFlatMdEntries(dirs: string[]): Promise<HarnessMdEntry[]> {
    const perDirectory = await Promise.all(
      dirs.map(async (directory) => {
        const listing = await this.listDir(directory);
        if (!listing.exists) return [];
        const files = listing.entries
          .filter((entry) => entry.type === 'file' && entry.path.endsWith('.md'))
          .slice(0, MAX_FLAT_MD_FILES);

        return Promise.all(
          files.map(async (entry) => {
            const read = await this.readFile(entry.path, MAX_FRONTMATTER_BYTES);
            const frontmatter = read ? parseFrontmatter(read.content) : {};
            return {
              name: frontmatter.name || basename(entry.path).replace(/\.md$/, ''),
              description: frontmatter.description ?? '',
              path: entry.path,
            };
          })
        );
      })
    );
    return perDirectory.flat().sort((a, b) => a.name.localeCompare(b.name));
  }

  private async loadMcpServers(spec: McpSourceSpec | null): Promise<HarnessMcpServer[]> {
    if (!spec) return [];
    const read = await this.readFile(spec.relativePath, MAX_MEMORY_FILE_BYTES);
    if (!read) return [];

    if (spec.kind === 'mcp-json') {
      try {
        const parsed = JSON.parse(read.content) as {
          mcpServers?: Record<string, { command?: string; args?: string[]; url?: string }>;
        };
        return Object.entries(parsed.mcpServers ?? {}).map(([name, server]) => ({
          name,
          detail: server.url ?? [server.command, ...(server.args ?? [])].filter(Boolean).join(' '),
          sourcePath: spec.relativePath,
        }));
      } catch {
        return [];
      }
    }

    return [...read.content.matchAll(/^\s*\[mcp_servers\.([^\]]+)\]/gm)].map((match) => ({
      name: match[1].replace(/^"|"$/g, ''),
      detail: '',
      sourcePath: spec.relativePath,
    }));
  }

  private async fileStatus(relativePath: string): Promise<HarnessFileStatus> {
    return { relativePath, exists: (await this.readFile(relativePath, 1)) !== null };
  }

  private listDir(relativePath: string): Promise<DirectoryListing> {
    const cached = this.listings.get(relativePath);
    if (cached) return cached;
    const promise = this.input.fileSystem
      .list(relativePath, { recursive: false, includeHidden: true, maxEntries: 500 })
      .then((result) => ({ exists: true, entries: result.entries }))
      .catch(() => ({ exists: false, entries: [] }));
    this.listings.set(relativePath, promise);
    return promise;
  }

  private readFile(relativePath: string, maxBytes: number): Promise<FileRead> {
    const key = `${relativePath}::${maxBytes}`;
    const cached = this.reads.get(key);
    if (cached) return cached;
    const promise = this.input.fileSystem.read(relativePath, maxBytes).catch(() => null);
    this.reads.set(key, promise);
    return promise;
  }

  private realPath(relativePath: string): Promise<string | null> {
    const cached = this.realPaths.get(relativePath);
    if (cached) return cached;
    const promise = this.input.fileSystem.realPath(relativePath).catch(() => null);
    this.realPaths.set(relativePath, promise);
    return promise;
  }
}

function parseFrontmatter(content: string): Record<string, string> {
  if (!content.startsWith('---')) return {};
  const end = content.indexOf('\n---', 3);
  if (end === -1) return {};

  const result: Record<string, string> = {};
  for (const line of content.slice(3, end).split('\n')) {
    const match = /^([A-Za-z][\w-]*)\s*:\s*(.+)$/.exec(line.trim());
    if (!match) continue;
    result[match[1]] = match[2].replace(/^["']|["']$/g, '').trim();
  }
  return result;
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/\/+$/, '');
}

function basename(value: string): string {
  return value.split(/[\\/]/).filter(Boolean).at(-1) ?? value;
}
