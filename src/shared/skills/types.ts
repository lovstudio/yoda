export interface SkillFrontmatter {
  name: string;
  description: string;
  license?: string;
  compatibility?: string;
  metadata?: Record<string, string>;
  'allowed-tools'?: string;
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
  /** Skill directory name */
  id: string;
  /** Human-readable display name */
  displayName: string;
  /** Short description */
  description: string;
  /** Catalog source */
  source: 'openai' | 'anthropic' | 'local';
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
}

export interface CatalogIndex {
  version: number;
  lastUpdated: string;
  skills: CatalogSkill[];
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
