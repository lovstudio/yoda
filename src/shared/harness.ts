import type { SkillRiskLevel, SkillScope } from './skills/types';

export type HarnessRuntimeId = 'claude' | 'codex';

export type McpSourceSpec =
  | { kind: 'mcp-json'; relativePath: string }
  | { kind: 'codex-toml'; relativePath: string };

export type RuntimeSurfaceSpec = {
  id: HarnessRuntimeId;
  /** Memory / system-prompt files, ordered by load priority. */
  memoryFiles: string[];
  /** Directories scanned recursively for SKILL.md folders. */
  skillDirs: string[];
  /** Directories holding flat *.md slash commands. Empty = unsupported. */
  commandDirs: string[];
  /** Directories holding *.md subagent definitions. Empty = unsupported. */
  subagentDirs: string[];
  /** Runtime settings files surfaced in the snapshot. */
  settingsFiles: string[];
  /** Project-level MCP server declaration, if the runtime supports one. */
  mcp: McpSourceSpec | null;
};

export type HarnessMemoryFile = {
  relativePath: string;
  content: string;
  truncated: boolean;
  totalSize: number;
};

export type ResolvedHarnessSkillLocation = {
  /** Project-relative directory where the Skill is exposed to the runtime. */
  path: string;
  /** Canonical catalog identity when the location resolves through SkillsService. */
  skillKey?: string;
  contentHash?: string;
  scope?: SkillScope;
  riskLevel?: SkillRiskLevel;
  disabled: boolean;
  validationIssueCount: number;
};

export type ResolvedHarnessSkill = {
  id: string;
  displayName: string;
  description: string;
  /** True only when every physical location is disabled. */
  disabled: boolean;
  /** Maximum issue count across locations, avoiding alias double-counting. */
  validationIssueCount: number;
  /** Physical runtime locations retained instead of collapsing provenance into a count. */
  locations: ResolvedHarnessSkillLocation[];
};

export type HarnessMdEntry = {
  name: string;
  description: string;
  /** Project-relative source file path. */
  path: string;
};

export type HarnessMcpServer = {
  name: string;
  detail: string;
  /** Project-relative config file declaring this server. */
  sourcePath: string;
};

export type HarnessFileStatus = {
  relativePath: string;
  exists: boolean;
};

export type HarnessRuntimeData = {
  memoryFiles: HarnessMemoryFile[];
  /** Memory file paths declared by the spec but absent in the project. */
  missingMemoryFiles: string[];
  skills: ResolvedHarnessSkill[];
  commands: HarnessMdEntry[];
  subagents: HarnessMdEntry[];
  mcpServers: HarnessMcpServer[];
  settingsFiles: HarnessFileStatus[];
  skillDirs: HarnessFileStatus[];
};

export type ResolvedHarnessSnapshot = {
  projectId: string;
  projectPath: string;
  projectType: 'local' | 'ssh';
  generatedAt: string;
  runtimes: Record<HarnessRuntimeId, HarnessRuntimeData>;
};

export const HARNESS_RUNTIMES: RuntimeSurfaceSpec[] = [
  {
    id: 'claude',
    memoryFiles: ['CLAUDE.md', 'CLAUDE.local.md', '.claude/CLAUDE.md'],
    skillDirs: ['.claude/skills'],
    commandDirs: ['.claude/commands'],
    subagentDirs: ['.claude/agents'],
    settingsFiles: ['.claude/settings.json', '.claude/settings.local.json'],
    mcp: { kind: 'mcp-json', relativePath: '.mcp.json' },
  },
  {
    id: 'codex',
    memoryFiles: ['AGENTS.md', '.codex/AGENTS.md'],
    skillDirs: ['.agents/skills', '.codex/skills'],
    commandDirs: [],
    subagentDirs: [],
    settingsFiles: ['.codex/config.toml'],
    mcp: { kind: 'codex-toml', relativePath: '.codex/config.toml' },
  },
];

export const MAX_MEMORY_FILE_BYTES = 64 * 1024;
export const MAX_FRONTMATTER_BYTES = 4 * 1024;
export const MAX_SKILL_TREE_DEPTH = 4;
export const MAX_FLAT_MD_FILES = 50;
