import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { CatalogIndex, CatalogSkill } from '@shared/skills/types';
import { resolveHarnessSnapshot, type ResolveHarnessSnapshotInput } from './skill-harness-resolver';

type HarnessFileSystem = ResolveHarnessSnapshotInput['fileSystem'];

function catalogSkill(
  key: string,
  id: string,
  localPath: string,
  options: Partial<CatalogSkill> = {}
): CatalogSkill {
  const description = `${id} description`;
  return {
    key,
    ref: { key, id, source: 'local', locator: localPath, contentHash: `${key}-hash` },
    id,
    displayName: id,
    description,
    source: 'local',
    scope: 'project',
    managed: false,
    frontmatter: { name: id, description },
    installed: true,
    localPath,
    contentHash: `${key}-hash`,
    ...options,
  };
}

function catalog(skills: CatalogSkill[]): CatalogIndex {
  return { version: 1, lastUpdated: new Date(0).toISOString(), skills };
}

function createFileSystem(
  files: Record<string, string>,
  realPathOverrides: Record<string, string> = {}
): HarnessFileSystem {
  const normalizedFiles = new Map(
    Object.entries(files).map(([filePath, content]) => [normalize(filePath), content])
  );
  const directories = new Set<string>(['.']);
  for (const filePath of normalizedFiles.keys()) {
    const parts = filePath.split('/');
    for (let index = 1; index < parts.length; index += 1) {
      directories.add(parts.slice(0, index).join('/'));
    }
  }

  return {
    async list(directoryPath) {
      const directory = normalize(directoryPath);
      if (!directories.has(directory)) throw new Error(`Missing directory: ${directory}`);
      const prefix = directory === '.' ? '' : `${directory}/`;
      const children = new Map<string, 'file' | 'dir'>();

      for (const filePath of normalizedFiles.keys()) {
        if (!filePath.startsWith(prefix)) continue;
        const remainder = filePath.slice(prefix.length);
        if (!remainder) continue;
        const [name, ...rest] = remainder.split('/');
        children.set(`${prefix}${name}`, rest.length > 0 ? 'dir' : 'file');
      }

      const entries = [...children].map(([entryPath, type]) => ({ path: entryPath, type }));
      return { entries, total: entries.length };
    },
    async read(filePath, maxBytes = Number.POSITIVE_INFINITY) {
      const content = normalizedFiles.get(normalize(filePath));
      if (content === undefined) throw new Error(`Missing file: ${filePath}`);
      const totalSize = Buffer.byteLength(content);
      return {
        content: Buffer.from(content).subarray(0, maxBytes).toString('utf8'),
        truncated: totalSize > maxBytes,
        totalSize,
      };
    },
    async realPath(relativePath) {
      const normalizedPath = normalize(relativePath);
      return realPathOverrides[normalizedPath] ?? path.posix.join('/repo', normalizedPath);
    },
  };
}

describe('skill harness resolver', () => {
  it('builds one runtime snapshot and retains catalog identity for every location', async () => {
    const fileSystem = createFileSystem({
      'CLAUDE.md': '# Project memory',
      '.claude/skills/review/SKILL.md': '---\nname: review\ndescription: Review code\n---\n',
      '.claude/commands/release.md': '---\nname: ship\ndescription: Create a release\n---\n',
      '.claude/agents/reviewer.md': '---\nname: reviewer\ndescription: Review changes\n---\n',
      '.mcp.json': JSON.stringify({ mcpServers: { github: { command: 'gh', args: ['mcp'] } } }),
      'AGENTS.md': '# Agent memory',
      '.agents/skills/review/SKILL.md': '---\nname: review\ndescription: Review code\n---\n',
      '.codex/skills/review/SKILL.md.disabled':
        '---\nname: review\ndescription: Review code\n---\n',
      '.codex/config.toml': '[mcp_servers.context7]\ncommand = "context7"\n',
    });
    const snapshot = await resolveHarnessSnapshot({
      projectId: 'project-1',
      projectPath: '/repo',
      projectType: 'local',
      fileSystem,
      catalog: catalog([
        catalogSkill('skill:claude-review', 'review', '/repo/.claude/skills/review', {
          displayName: 'Code Review',
          description: 'Review the current code changes',
          riskLevel: 'elevated',
          validationIssues: [
            {
              severity: 'warning',
              agent: 'spec',
              field: 'description',
              code: 'description-short',
              message: 'Description is short',
            },
          ],
        }),
        catalogSkill('skill:agents-review', 'review', '/repo/.agents/skills/review'),
        catalogSkill('skill:codex-review', 'review', '/repo/.codex/skills/review', {
          disabled: true,
          validationIssues: [
            {
              severity: 'warning',
              agent: 'codex',
              field: 'name',
              code: 'name-mismatch',
              message: 'Name differs from directory',
            },
            {
              severity: 'warning',
              agent: 'spec',
              field: 'description',
              code: 'description-short',
              message: 'Description is short',
            },
          ],
        }),
      ]),
    });

    expect(snapshot).toEqual(
      expect.objectContaining({
        projectId: 'project-1',
        projectPath: '/repo',
        projectType: 'local',
      })
    );
    expect(snapshot.runtimes.claude.memoryFiles[0]?.relativePath).toBe('CLAUDE.md');
    expect(snapshot.runtimes.claude.skills).toEqual([
      expect.objectContaining({
        id: 'review',
        displayName: 'Code Review',
        description: 'Review the current code changes',
        disabled: false,
        validationIssueCount: 1,
        locations: [
          expect.objectContaining({
            path: '.claude/skills/review',
            skillKey: 'skill:claude-review',
            riskLevel: 'elevated',
          }),
        ],
      }),
    ]);
    expect(snapshot.runtimes.claude.commands).toEqual([
      { name: 'ship', description: 'Create a release', path: '.claude/commands/release.md' },
    ]);
    expect(snapshot.runtimes.claude.subagents).toEqual([
      {
        name: 'reviewer',
        description: 'Review changes',
        path: '.claude/agents/reviewer.md',
      },
    ]);
    expect(snapshot.runtimes.claude.mcpServers).toEqual([
      { name: 'github', detail: 'gh mcp', sourcePath: '.mcp.json' },
    ]);

    const codexSkill = snapshot.runtimes.codex.skills[0];
    expect(codexSkill).toEqual(
      expect.objectContaining({ id: 'review', disabled: false, validationIssueCount: 2 })
    );
    expect(codexSkill?.locations.map((location) => location.skillKey)).toEqual([
      'skill:agents-review',
      'skill:codex-review',
    ]);
    expect(snapshot.runtimes.codex.mcpServers).toEqual([
      { name: 'context7', detail: '', sourcePath: '.codex/config.toml' },
    ]);
  });

  it('uses canonical paths to associate symlinked project locations with catalog Skills', async () => {
    const fileSystem = createFileSystem(
      {
        '.claude/skills/review/SKILL.md': '---\nname: review\ndescription: Review code\n---\n',
      },
      { '.claude/skills/review': '/external/skills/review' }
    );
    const snapshot = await resolveHarnessSnapshot({
      projectId: 'project-1',
      projectPath: '/repo',
      projectType: 'local',
      fileSystem,
      catalog: catalog([
        catalogSkill('skill:external-review', 'review', '/external/skills/review'),
      ]),
    });

    expect(snapshot.runtimes.claude.skills[0]?.locations[0]?.skillKey).toBe(
      'skill:external-review'
    );
  });

  it('keeps nested SSH Skills visible even when no local catalog is available', async () => {
    const snapshot = await resolveHarnessSnapshot({
      projectId: 'remote-project',
      projectPath: '/srv/repo',
      projectType: 'ssh',
      fileSystem: createFileSystem({
        '.agents/skills/team/review/SKILL.md': '---\nname: review\ndescription: Review code\n---\n',
      }),
    });

    expect(snapshot.runtimes.codex.skills).toEqual([
      {
        id: 'team:review',
        displayName: 'team:review',
        description: '',
        disabled: false,
        validationIssueCount: 0,
        locations: [
          {
            path: '.agents/skills/team/review',
            disabled: false,
            validationIssueCount: 0,
          },
        ],
      },
    ]);
  });
});

function normalize(value: string): string {
  const normalized = value.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
  return normalized || '.';
}
