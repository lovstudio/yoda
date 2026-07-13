import type { RuntimeId } from '../runtime-registry';

export interface SkillFrontmatter {
  name: string;
  description: string;
  license?: string;
  compatibility?: string;
  metadata?: Record<string, string>;
  'allowed-tools'?: string;
  when_to_use?: string;
  'disable-model-invocation'?: string;
  'user-invocable'?: string;
}

export type SkillCatalogSource =
  | 'openai'
  | 'anthropic'
  | 'lovstudio-general'
  | 'lovstudio-dev'
  | 'local';

export type SkillScope = 'catalog' | 'managed' | 'user' | 'project' | 'plugin';

export type SkillInvocationMode = 'auto' | 'manual' | 'off';

/** Stable identity. Names are deliberately not unique across sources or paths. */
export interface SkillRef {
  /** Opaque identity used by RPC, routes and persisted Agent profiles. */
  key: string;
  /** Runtime invocation/directory name. */
  id: string;
  source: SkillCatalogSource;
  /** Canonical filesystem path or immutable catalog URL. */
  locator: string;
  version?: string;
  contentHash?: string;
}

export interface SkillDependency {
  type: 'mcp' | 'command' | 'runtime' | 'other';
  value: string;
  description?: string;
  available?: boolean;
}

export type SkillRiskLevel = 'low' | 'elevated' | 'high';

export interface SkillHealthIssue {
  severity: 'info' | 'warning' | 'error';
  code:
    | 'identity-conflict'
    | 'runtime-name-conflict'
    | 'duplicate-installation'
    | 'external-install'
    | 'validation'
    | 'scripted'
    | 'network-access'
    | 'dependency-missing'
    | 'unreviewed'
    | 'content-changed'
    | 'content-scan-limited'
    | 'runtime-isolation-limited';
  message: string;
  relatedSkillKeys?: string[];
}

export interface SkillInstallation {
  path: string;
  managed: boolean;
  scope: Exclude<SkillScope, 'catalog'>;
  runtimeIds: RuntimeId[];
  contentHash: string;
  fileCount: number;
  totalBytes: number;
  sourceKey?: string;
}

export interface SkillValidationIssue {
  severity: 'error' | 'warning';
  /** 'codex' = Codex runtime compatibility; 'spec' = Agent Skills format spec */
  agent: 'codex' | 'spec';
  field: string;
  code: string;
  message: string;
  path?: string;
  max?: number;
  actual?: number;
}

export interface CatalogSkill {
  /** Unique instance identity. Use this for keys/routes/actions, never `id`. */
  key: string;
  ref: SkillRef;
  /** Skill directory name */
  id: string;
  /** Human-readable display name */
  displayName: string;
  /** Short description */
  description: string;
  /** Catalog source */
  source: SkillCatalogSource;
  scope: SkillScope;
  /** Whether Yoda owns this installation and may update/remove it. */
  managed: boolean;
  /** GitHub URL */
  sourceUrl?: string;
  /** Icon URL (OpenAI skills have SVG/PNG) */
  iconUrl?: string;
  /** Hex color */
  brandColor?: string;
  /** Example prompt */
  defaultPrompt?: string;
  /** Full SKILL.md content (loaded lazily) */
  skillMdContent?: string;
  /** Parsed frontmatter */
  frontmatter: SkillFrontmatter;
  /** Agent compatibility or format validation issues */
  validationIssues?: SkillValidationIssue[];
  /** Whether skill is installed locally */
  installed: boolean;
  /** Whether installed skill is locally disabled without uninstalling */
  disabled?: boolean;
  /** Filesystem path if installed */
  localPath?: string;
  installation?: SkillInstallation;
  contentHash?: string;
  workflowId?: string;
  variant?: string;
  version?: string;
  dependencies?: SkillDependency[];
  riskLevel?: SkillRiskLevel;
  healthIssues?: SkillHealthIssue[];
  conflictKeys?: string[];
}

export interface CatalogIndex {
  version: number;
  lastUpdated: string;
  skills: CatalogSkill[];
}

/** Agent-authored selection before paths and runtime capabilities are resolved. */
export interface SkillSelectionInput {
  autoSkillKeys: string[];
  manualSkillKeys: string[];
}

export interface SkillSessionEntry {
  key: string;
  id: string;
  path: string;
  contentHash: string;
  mode: Exclude<SkillInvocationMode, 'off'>;
  scope: Exclude<SkillScope, 'catalog'>;
}

/** Immutable snapshot persisted with a conversation and reused on resume. */
export interface SkillSessionPolicy {
  source: 'agent-profile';
  entries: SkillSessionEntry[];
  /** Every discovered entry, including disabled ones, needed for runtime isolation. */
  available: Array<Pick<SkillSessionEntry, 'key' | 'id' | 'path' | 'scope'>>;
  warnings: string[];
  createdAt: string;
}

export interface SkillRouteSuggestion {
  skillKey: string;
  skillId: string;
  displayName: string;
  score: number;
  confidence: 'high' | 'medium' | 'low';
  reason: string;
}

export interface SkillFileSnapshot {
  path: string;
  hash: string;
  bytes: number;
  binary: boolean;
  /** Text content was intentionally omitted from IPC/audit because it exceeded a safety limit. */
  tooLarge?: boolean;
  content?: string;
}

export interface SkillEvaluationCase {
  id: string;
  text: string;
  expectation: 'trigger' | 'no-trigger' | 'neighbor';
  expectedSkillKey?: string;
}

export interface SkillEvaluationResult {
  caseId: string;
  result: SkillTriggerRunResult;
  passed: boolean;
  runtime: RuntimeId;
  contentHash?: string;
  runAt: string;
}

export interface SkillEvaluationRecord {
  skillKey: string;
  cases: SkillEvaluationCase[];
  results: SkillEvaluationResult[];
  updatedAt: string;
}

/** One trigger-test query for a skill, with the expected outcome. */
export interface SkillTriggerQuery {
  text: string;
  shouldTrigger: boolean;
}

export interface SkillTriggerRunResult {
  status: 'triggered' | 'not-triggered' | 'other-skill' | 'error' | 'timeout';
  /** Skill actually invoked when one was, e.g. for other-skill diagnostics */
  matchedSkill?: string;
  durationMs: number;
  error?: string;
}

export interface DetectedAgent {
  id: string;
  name: string;
  configDir: string;
  installed: boolean;
}

/** Per-skill invocation stats parsed from local runtime data via the skillusage CLI. */
export interface SkillUsageStat {
  /** Normalized skill name as reported by skillusage */
  skill: string;
  total: number;
  /** User-typed invocations (slash command / $prefix) */
  manual: number;
  /** Agent-initiated invocations */
  auto: number;
  /** ISO 8601, null when never used */
  lastUsedAt: string | null;
  /** Local-timezone YYYY-MM-DD -> count */
  daily: Record<string, number>;
}

export interface SkillUsageIndex {
  generatedAt: string;
  /** Lookup keyed by lowercased normalized skill name and every raw alias */
  bySkill: Record<string, SkillUsageStat>;
}
