import type { RuntimeId } from './runtime-registry';

export type DoctorHealthStatus = 'healthy' | 'attention' | 'critical' | 'inactive';
export type DoctorIssueSeverity = 'info' | 'warning' | 'error';

export type DoctorIssue = {
  id: string;
  severity: DoctorIssueSeverity;
  title: string;
  detail: string;
  runtimeId?: RuntimeId;
  skillKey?: string;
  serverName?: string;
};

export type DoctorConfigFile = {
  kind: 'prompt' | 'settings' | 'mcp';
  path: string;
  exists: boolean;
  bytes: number | null;
};

export type DoctorSkillUsage = {
  skillKey: string;
  name: string;
  total: number;
  lastUsedAt: string | null;
};

export type DoctorSkillSummary = {
  total: number;
  active: number;
  disabled: number;
  issueCount: number;
  conflictCount: number;
  topUsed: DoctorSkillUsage[];
};

export type DoctorMcpServer = {
  name: string;
  transport: 'stdio' | 'http';
  detail: string;
  status: 'ready' | 'attention' | 'unchecked';
  message: string;
};

export type DoctorMcpSummary = {
  configPath: string | null;
  configExists: boolean;
  total: number;
  issueCount: number;
  servers: DoctorMcpServer[];
};

export type DoctorRuntimeReport = {
  id: RuntimeId;
  name: string;
  installed: boolean;
  disabled: boolean;
  version: string | null;
  executablePath: string | null;
  installCommand: string | null;
  uninstallCommand: string | null;
  harnessSupport: 'full' | 'runtime-only';
  score: number;
  status: DoctorHealthStatus;
  configFiles: DoctorConfigFile[];
  skills: DoctorSkillSummary;
  mcp: DoctorMcpSummary;
  issues: DoctorIssue[];
};

export type DoctorProjectSummary = {
  id: string;
  name: string;
  path: string;
  type: 'local' | 'ssh';
  updatedAt: string;
};

export type DoctorSnapshot = {
  generatedAt: string;
  score: number;
  status: DoctorHealthStatus;
  installedRuntimeCount: number;
  availableRuntimeCount: number;
  skillCount: number;
  activeSkillCount: number;
  mcpServerCount: number;
  projectCount: number;
  issues: DoctorIssue[];
  runtimes: DoctorRuntimeReport[];
  projects: DoctorProjectSummary[];
};

export type DoctorWorkspaceRuntimeReport = {
  id: 'claude' | 'codex';
  score: number;
  status: DoctorHealthStatus;
  promptFiles: string[];
  missingPromptFiles: string[];
  skills: number;
  disabledSkills: number;
  skillIssues: number;
  commands: number;
  subagents: number;
  mcpServers: number;
  issues: DoctorIssue[];
};

export type DoctorWorkspaceReport = {
  projectId: string;
  projectName: string;
  projectPath: string;
  generatedAt: string;
  score: number;
  status: DoctorHealthStatus;
  runtimes: DoctorWorkspaceRuntimeReport[];
  issues: DoctorIssue[];
};
