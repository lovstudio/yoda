import { readFile, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import * as toml from 'smol-toml';
import type { DependencyState } from '@shared/dependencies';
import type {
  DoctorConfigFile,
  DoctorIssue,
  DoctorMcpServer,
  DoctorMcpSummary,
  DoctorRuntimeReport,
  DoctorSkillSummary,
  DoctorSnapshot,
  DoctorWorkspaceReport,
  DoctorWorkspaceRuntimeReport,
} from '@shared/doctor';
import type { McpServer } from '@shared/mcp/types';
import { projectDisplayName } from '@shared/projects';
import {
  listDetectableRuntimes,
  type RuntimeDefinition,
  type RuntimeId,
} from '@shared/runtime-registry';
import type { CatalogSkill, SkillUsageIndex } from '@shared/skills/types';
import { getDependencyManager } from '@main/core/dependencies/dependency-manager';
import { resolveCommandPath } from '@main/core/dependencies/probe';
import { LocalExecutionContext } from '@main/core/execution-context/local-execution-context';
import { mcpService } from '@main/core/mcp/services/McpService';
import { getAgentMcpMeta } from '@main/core/mcp/utils/config-paths';
import { getProjectById, getProjects } from '@main/core/projects/operations/getProjects';
import { runtimeOverrideSettings } from '@main/core/settings/runtime-settings-service';
import { getResolvedHarnessSnapshot } from '@main/core/skills/get-resolved-harness-snapshot';
import { getPersistedSkillUsageStats } from '@main/core/skills/getUsageStats';
import { skillsService } from '@main/core/skills/SkillsService';
import { doctorStatus } from './doctor-score';

const GLOBAL_HARNESS_FILES: Partial<
  Record<RuntimeId, Array<{ kind: DoctorConfigFile['kind']; path: string }>>
> = {
  claude: [
    { kind: 'prompt', path: path.join(os.homedir(), '.claude', 'CLAUDE.md') },
    { kind: 'settings', path: path.join(os.homedir(), '.claude', 'settings.json') },
    { kind: 'settings', path: path.join(os.homedir(), '.claude', 'settings.local.json') },
  ],
  codex: [
    { kind: 'prompt', path: path.join(os.homedir(), '.codex', 'AGENTS.md') },
    { kind: 'settings', path: path.join(os.homedir(), '.codex', 'config.toml') },
  ],
};

const FULL_HARNESS_RUNTIMES = new Set<RuntimeId>(['claude', 'codex']);
const LARGE_PROMPT_BYTES = 256 * 1024;
const MANY_ACTIVE_SKILLS = 60;

function clampScore(score: number): number {
  return Math.max(0, Math.min(100, Math.round(score)));
}

function issueWeight(issue: DoctorIssue): number {
  if (issue.severity === 'error') return 12;
  if (issue.severity === 'warning') return 5;
  return 0;
}

function issueId(parts: Array<string | undefined>): string {
  return parts
    .filter(Boolean)
    .join(':')
    .replace(/[^a-zA-Z0-9:_-]/g, '-');
}

async function inspectFile(
  entry: NonNullable<(typeof GLOBAL_HARNESS_FILES)[RuntimeId]>[number]
): Promise<DoctorConfigFile> {
  try {
    const details = await stat(entry.path);
    return {
      ...entry,
      exists: details.isFile(),
      bytes: details.isFile() ? details.size : null,
    };
  } catch {
    return { ...entry, exists: false, bytes: null };
  }
}

function uniqueInstalledSkills(skills: CatalogSkill[]): CatalogSkill[] {
  const byPath = new Map<string, CatalogSkill>();
  for (const skill of skills) {
    if (!skill.installed) continue;
    const key = skill.localPath ?? skill.key;
    const existing = byPath.get(key);
    if (!existing || (existing.healthIssues?.length ?? 0) < (skill.healthIssues?.length ?? 0)) {
      byPath.set(key, skill);
    }
  }
  return [...byPath.values()];
}

function skillAppliesToRuntime(skill: CatalogSkill, runtimeId: RuntimeId): boolean {
  if (skill.installation?.runtimeIds.includes(runtimeId)) return true;
  const normalized = skill.localPath?.replace(/\\/g, '/') ?? '';
  if (runtimeId === 'claude') return normalized.includes('/.claude/');
  if (runtimeId === 'codex') {
    return normalized.includes('/.codex/') || normalized.includes('/.agents/skills/');
  }
  return false;
}

function usageForSkill(skill: CatalogSkill, usage: SkillUsageIndex | null) {
  if (!usage) return null;
  for (const key of [skill.id, skill.frontmatter.name, skill.displayName]) {
    const value = usage.bySkill[key?.toLocaleLowerCase()];
    if (value) return value;
  }
  return null;
}

function summarizeSkills(
  runtimeId: RuntimeId,
  allSkills: CatalogSkill[],
  usage: SkillUsageIndex | null
): { summary: DoctorSkillSummary; issues: DoctorIssue[] } {
  const skills = allSkills.filter((skill) => skillAppliesToRuntime(skill, runtimeId));
  const issues: DoctorIssue[] = [];

  for (const skill of skills) {
    const validationErrors = skill.validationIssues?.filter((issue) => issue.severity === 'error');
    if (validationErrors?.length) {
      issues.push({
        id: issueId(['skill-validation', runtimeId, skill.key]),
        severity: 'error',
        title: `${skill.displayName} 格式校验失败`,
        detail: `${validationErrors.length} 个错误会影响客户端加载或触发。`,
        runtimeId,
        skillKey: skill.key,
      });
    }
    const warningCount =
      skill.healthIssues?.filter((issue) => issue.severity === 'warning').length ?? 0;
    if (warningCount > 0) {
      issues.push({
        id: issueId(['skill-health', runtimeId, skill.key]),
        severity: 'warning',
        title: `${skill.displayName} 需要检查`,
        detail: `${warningCount} 个健康度提醒，包括内容变化、依赖或审阅状态。`,
        runtimeId,
        skillKey: skill.key,
      });
    }
    if ((skill.conflictKeys?.length ?? 0) > 0) {
      issues.push({
        id: issueId(['skill-conflict', runtimeId, skill.key]),
        severity: 'warning',
        title: `${skill.displayName} 存在同名或重复安装`,
        detail: '多个版本可能让 Agent 触发到非预期实现。',
        runtimeId,
        skillKey: skill.key,
      });
    }
  }

  const active = skills.filter((skill) => !skill.disabled);
  if (active.length > MANY_ACTIVE_SKILLS) {
    issues.push({
      id: issueId(['skill-volume', runtimeId]),
      severity: 'warning',
      title: `${active.length} 个 Skill 同时启用`,
      detail: '建议按 Agent 或工作区保留高频能力，并禁用低频、重复或过度宽泛的 Skill。',
      runtimeId,
    });
  }

  const topUsed = skills
    .map((skill) => ({ skill, usage: usageForSkill(skill, usage) }))
    .filter(
      (entry): entry is { skill: CatalogSkill; usage: NonNullable<typeof entry.usage> } =>
        entry.usage !== null
    )
    .sort((a, b) => b.usage.total - a.usage.total)
    .slice(0, 5)
    .map(({ skill, usage: stat }) => ({
      skillKey: skill.key,
      name: skill.displayName,
      total: stat.total,
      lastUsedAt: stat.lastUsedAt,
    }));

  return {
    summary: {
      total: skills.length,
      active: active.length,
      disabled: skills.length - active.length,
      issueCount: issues.filter((issue) => issue.severity !== 'info').length,
      conflictCount: skills.filter((skill) => (skill.conflictKeys?.length ?? 0) > 0).length,
      topUsed,
    },
    issues,
  };
}

function parseConfig(raw: string, configPath: string): void {
  if (configPath.endsWith('.toml')) {
    toml.parse(raw);
    return;
  }
  JSON.parse(raw);
}

async function inspectMcp(
  runtimeId: RuntimeId,
  installedServers: McpServer[],
  execution: LocalExecutionContext
): Promise<{ summary: DoctorMcpSummary; issues: DoctorIssue[] }> {
  const meta = getAgentMcpMeta(runtimeId);
  if (!meta) {
    return {
      summary: {
        configPath: null,
        configExists: false,
        total: 0,
        issueCount: 0,
        servers: [],
      },
      issues: [],
    };
  }

  let configExists = false;
  const issues: DoctorIssue[] = [];
  try {
    const raw = await readFile(meta.configPath, 'utf8');
    configExists = true;
    if (raw.trim()) parseConfig(raw, meta.configPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      issues.push({
        id: issueId(['mcp-config', runtimeId]),
        severity: 'error',
        title: 'MCP 配置解析失败',
        detail: error instanceof Error ? error.message : String(error),
        runtimeId,
      });
    }
  }

  const servers = installedServers.filter((server) => server.providers.includes(runtimeId));
  const diagnostics = await Promise.all(
    servers.map(async (server): Promise<DoctorMcpServer> => {
      if (server.transport === 'http') {
        try {
          const url = new URL(server.url ?? '');
          if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('protocol');
          return {
            name: server.name,
            transport: server.transport,
            detail: url.toString(),
            status: 'unchecked',
            message: '配置有效；远程连接状态暂不计分。',
          };
        } catch {
          issues.push({
            id: issueId(['mcp-url', runtimeId, server.name]),
            severity: 'error',
            title: `${server.name} 的地址无效`,
            detail: 'HTTP MCP Server 需要有效的 http 或 https URL。',
            runtimeId,
            serverName: server.name,
          });
          return {
            name: server.name,
            transport: server.transport,
            detail: server.url ?? '',
            status: 'attention',
            message: 'URL 无效',
          };
        }
      }

      if (!server.command?.trim()) {
        issues.push({
          id: issueId(['mcp-command', runtimeId, server.name]),
          severity: 'error',
          title: `${server.name} 缺少启动命令`,
          detail: 'stdio MCP Server 需要 command 字段。',
          runtimeId,
          serverName: server.name,
        });
        return {
          name: server.name,
          transport: server.transport,
          detail: '',
          status: 'attention',
          message: '缺少启动命令',
        };
      }

      const executable = await resolveCommandPath(server.command, execution);
      if (!executable) {
        issues.push({
          id: issueId(['mcp-executable', runtimeId, server.name]),
          severity: 'error',
          title: `${server.name} 的启动命令不存在`,
          detail: `未在本机找到 ${server.command}。`,
          runtimeId,
          serverName: server.name,
        });
        return {
          name: server.name,
          transport: server.transport,
          detail: [server.command, ...(server.args ?? [])].join(' '),
          status: 'attention',
          message: '启动命令不可用',
        };
      }

      return {
        name: server.name,
        transport: server.transport,
        detail: [server.command, ...(server.args ?? [])].join(' '),
        status: 'ready',
        message: '启动命令可用',
      };
    })
  );

  return {
    summary: {
      configPath: meta.configPath,
      configExists,
      total: diagnostics.length,
      issueCount: issues.filter((issue) => issue.severity !== 'info').length,
      servers: diagnostics,
    },
    issues,
  };
}

async function buildRuntimeReport(
  runtime: RuntimeDefinition,
  skills: CatalogSkill[],
  usage: SkillUsageIndex | null,
  installedServers: McpServer[],
  execution: LocalExecutionContext,
  configs: Awaited<ReturnType<typeof runtimeOverrideSettings.getAll>>,
  dependency: DependencyState | null
): Promise<DoctorRuntimeReport> {
  const installed = dependency?.status === 'available';
  const disabled = configs[runtime.id]?.disabled === true;
  const configFiles = await Promise.all((GLOBAL_HARNESS_FILES[runtime.id] ?? []).map(inspectFile));
  const skillResult = summarizeSkills(runtime.id, skills, usage);
  const mcpResult = await inspectMcp(runtime.id, installedServers, execution);
  const issues = [...skillResult.issues, ...mcpResult.issues];

  for (const file of configFiles) {
    if (file.kind === 'prompt' && file.exists && (file.bytes ?? 0) > LARGE_PROMPT_BYTES) {
      issues.push({
        id: issueId(['prompt-size', runtime.id, file.path]),
        severity: 'warning',
        title: '全局 Prompt 体积过大',
        detail: `${file.path} 已超过 256 KB，建议拆分为按需加载的规则或 Skill。`,
        runtimeId: runtime.id,
      });
    }
  }

  if (!installed) {
    return {
      id: runtime.id,
      name: runtime.name,
      installed: false,
      disabled: false,
      version: dependency?.version ?? null,
      executablePath: dependency?.path ?? null,
      installCommand: runtime.installCommand ?? null,
      uninstallCommand: runtime.uninstallCommand ?? null,
      harnessSupport: FULL_HARNESS_RUNTIMES.has(runtime.id) ? 'full' : 'runtime-only',
      score: 0,
      status: 'inactive',
      configFiles,
      skills: skillResult.summary,
      mcp: mcpResult.summary,
      issues: [],
    };
  }

  let score = 100;
  for (const issue of issues) score -= issueWeight(issue);
  const normalizedScore = clampScore(score);

  return {
    id: runtime.id,
    name: runtime.name,
    installed,
    disabled,
    version: dependency?.version ?? null,
    executablePath: dependency?.path ?? null,
    installCommand: runtime.installCommand ?? null,
    uninstallCommand: runtime.uninstallCommand ?? null,
    harnessSupport: FULL_HARNESS_RUNTIMES.has(runtime.id) ? 'full' : 'runtime-only',
    score: normalizedScore,
    status: doctorStatus(normalizedScore, disabled),
    configFiles,
    skills: skillResult.summary,
    mcp: mcpResult.summary,
    issues,
  };
}

function topIssues(issues: DoctorIssue[]): DoctorIssue[] {
  const severity = { error: 0, warning: 1, info: 2 } as const;
  return [...new Map(issues.map((issue) => [issue.id, issue])).values()]
    .sort((a, b) => severity[a.severity] - severity[b.severity])
    .slice(0, 12);
}

export async function scanDoctor(args?: { refresh?: boolean }): Promise<DoctorSnapshot> {
  const manager = await getDependencyManager();
  if (args?.refresh || manager.getByCategory('agent').length === 0) {
    await manager.probeCategory('agent');
  }

  const [catalog, configs, mcp, projects, usage] = await Promise.all([
    skillsService.getCatalogIndex(),
    runtimeOverrideSettings.getAll(),
    mcpService.loadAll(),
    getProjects(),
    getPersistedSkillUsageStats().catch(() => null),
  ]);
  const skills = uniqueInstalledSkills(catalog.skills);
  const execution = new LocalExecutionContext();

  try {
    const runtimes = await Promise.all(
      listDetectableRuntimes().map((runtime) =>
        buildRuntimeReport(
          runtime,
          skills,
          usage,
          mcp.installed,
          execution,
          configs,
          manager.get(runtime.id) ?? null
        )
      )
    );
    runtimes.sort((a, b) => {
      if (a.installed !== b.installed) return a.installed ? -1 : 1;
      if (a.disabled !== b.disabled) return a.disabled ? 1 : -1;
      return a.name.localeCompare(b.name);
    });

    const activeRuntimes = runtimes.filter((runtime) => runtime.installed && !runtime.disabled);
    const score =
      activeRuntimes.length > 0
        ? clampScore(
            activeRuntimes.reduce((total, runtime) => total + runtime.score, 0) /
              activeRuntimes.length
          )
        : 0;
    const visibleProjects = projects.filter((project) => !project.isInternal);
    const issues = topIssues(activeRuntimes.flatMap((runtime) => runtime.issues));

    return {
      generatedAt: new Date().toISOString(),
      score,
      status: doctorStatus(score, activeRuntimes.length === 0),
      installedRuntimeCount: runtimes.filter((runtime) => runtime.installed).length,
      availableRuntimeCount: runtimes.length,
      skillCount: skills.length,
      activeSkillCount: skills.filter((skill) => !skill.disabled).length,
      mcpServerCount: mcp.installed.length,
      projectCount: visibleProjects.length,
      issues,
      runtimes,
      projects: visibleProjects.map((project) => ({
        id: project.id,
        name: projectDisplayName(project),
        path: project.path,
        type: project.type,
        updatedAt: project.updatedAt,
      })),
    };
  } finally {
    execution.dispose();
  }
}

function workspaceRuntimeReport(
  runtimeId: 'claude' | 'codex',
  data: Awaited<ReturnType<typeof getResolvedHarnessSnapshot>>['runtimes']['claude']
): DoctorWorkspaceRuntimeReport {
  const issues: DoctorIssue[] = [];
  const skillIssues = data.skills.reduce(
    (total, skill) => total + (skill.validationIssueCount > 0 ? 1 : 0),
    0
  );
  for (const skill of data.skills) {
    if (skill.validationIssueCount === 0) continue;
    issues.push({
      id: issueId(['workspace-skill', runtimeId, skill.id]),
      severity: 'error',
      title: `${skill.displayName} 有格式问题`,
      detail: `${skill.validationIssueCount} 个校验问题可能影响当前工作区。`,
      runtimeId,
    });
  }
  for (const memory of data.memoryFiles) {
    if (!memory.truncated) continue;
    issues.push({
      id: issueId(['workspace-prompt-size', runtimeId, memory.relativePath]),
      severity: 'warning',
      title: `${memory.relativePath} 过大`,
      detail: '诊断只读取了前 64 KB，建议拆分全局规则和按需知识。',
      runtimeId,
    });
  }
  const duplicated = data.skills.filter((skill) => skill.locations.length > 1);
  for (const skill of duplicated) {
    issues.push({
      id: issueId(['workspace-skill-duplicate', runtimeId, skill.id]),
      severity: 'warning',
      title: `${skill.displayName} 暴露在多个位置`,
      detail: skill.locations.map((location) => location.path).join('、'),
      runtimeId,
    });
  }

  const score = clampScore(100 - issues.reduce((total, issue) => total + issueWeight(issue), 0));
  return {
    id: runtimeId,
    score,
    status: doctorStatus(score),
    promptFiles: data.memoryFiles.map((file) => file.relativePath),
    missingPromptFiles: data.missingMemoryFiles,
    skills: data.skills.length,
    disabledSkills: data.skills.filter((skill) => skill.disabled).length,
    skillIssues,
    commands: data.commands.length,
    subagents: data.subagents.length,
    mcpServers: data.mcpServers.length,
    issues,
  };
}

export async function scanDoctorWorkspace(projectId: string): Promise<DoctorWorkspaceReport> {
  const [project, snapshot] = await Promise.all([
    getProjectById(projectId),
    getResolvedHarnessSnapshot(projectId),
  ]);
  if (!project) throw new Error('Project not found.');

  const runtimes = [
    workspaceRuntimeReport('claude', snapshot.runtimes.claude),
    workspaceRuntimeReport('codex', snapshot.runtimes.codex),
  ];
  const score = clampScore(
    runtimes.reduce((total, runtime) => total + runtime.score, 0) / runtimes.length
  );
  const issues = topIssues(runtimes.flatMap((runtime) => runtime.issues));

  return {
    projectId,
    projectName: projectDisplayName(project),
    projectPath: project.path,
    generatedAt: snapshot.generatedAt,
    score,
    status: doctorStatus(score),
    runtimes,
    issues,
  };
}
