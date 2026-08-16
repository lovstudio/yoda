import z from 'zod';
import { LEGACY_RUN_MODES, normalizeLegacyRunMode } from './paradigms/kinds';
import {
  PROMPT_SOURCE_DEFAULT_REFRESH_MINUTES,
  PROMPT_SOURCE_DEFAULT_TIMEOUT_SECONDS,
  PROMPT_SOURCE_MAX_REFRESH_MINUTES,
  PROMPT_SOURCE_MAX_TIMEOUT_SECONDS,
  PROMPT_SOURCE_MIN_REFRESH_MINUTES,
  PROMPT_SOURCE_MIN_TIMEOUT_SECONDS,
  promptSourceErrorCodeSchema,
  promptSourceErrorSchema,
  promptSourceSchema,
  type PromptSource,
  type PromptSourceError,
  type PromptSourceLoadResult,
  type PromptSourceRefreshResult,
} from './prompt-library';
import { runtimeIdSchema } from './runtime-id-schema';

export const PROJECT_CONFIG_FILE = '.yoda.json';

export const DEFAULT_PRESERVE_PATTERNS = [
  '.env',
  '.env.keys',
  '.env.local',
  '.env.*.local',
  '.envrc',
  'docker-compose.override.yml',
] as const;

export const defaultBranchSettingSchema = z.union([
  z.string(),
  z.object({ name: z.string(), remote: z.literal(true) }),
]);

export type DefaultBranchSetting = z.infer<typeof defaultBranchSettingSchema>;

const preservePatternsSchema = z
  .array(z.string())
  .transform((patterns) => patterns.filter((pattern) => pattern !== PROJECT_CONFIG_FILE));

export const shareableProjectScriptsSettingsSchema = z.object({
  setup: z.string().optional(),
  run: z.string().optional(),
  teardown: z.string().optional(),
});

const quickActionKindSchema = z.preprocess(
  (value) => {
    // Keep project files written by older Yoda versions readable while exposing
    // the product model users actually interact with: a quick action is either
    // a deterministic command or a reusable Skill instruction.
    if (value === undefined || value === 'agent') return 'skill';
    if (value === 'shell') return 'command';
    return value;
  },
  z.enum(['command', 'skill'])
);

export const quickActionSchema = z.object({
  id: z.string(),
  label: z.string(),
  command: z.string(),
  /**
   * Skill actions open an inspectable Yoda task so intelligent work can
   * continue in context. Commands run in the shared project Terminal.
   */
  kind: quickActionKindSchema,
  sourceIntent: z.string().optional(),
});

export type QuickAction = z.infer<typeof quickActionSchema>;

/**
 * Legacy project-local prompt shape. App-global entries are migrated to the
 * prompt library; this remains for `.yoda.json` compatibility.
 */
export const promptPrincipleSourceErrorCodeSchema = promptSourceErrorCodeSchema;
export type PromptPrincipleSourceErrorCode = z.infer<typeof promptPrincipleSourceErrorCodeSchema>;
export const promptPrincipleSourceErrorSchema = promptSourceErrorSchema;
export type PromptPrincipleSourceError = PromptSourceError;
export const PROMPT_PRINCIPLE_SOURCE_DEFAULT_REFRESH_MINUTES =
  PROMPT_SOURCE_DEFAULT_REFRESH_MINUTES;
export const PROMPT_PRINCIPLE_SOURCE_MIN_REFRESH_MINUTES = PROMPT_SOURCE_MIN_REFRESH_MINUTES;
export const PROMPT_PRINCIPLE_SOURCE_MAX_REFRESH_MINUTES = PROMPT_SOURCE_MAX_REFRESH_MINUTES;
export const PROMPT_PRINCIPLE_SOURCE_DEFAULT_TIMEOUT_SECONDS =
  PROMPT_SOURCE_DEFAULT_TIMEOUT_SECONDS;
export const PROMPT_PRINCIPLE_SOURCE_MIN_TIMEOUT_SECONDS = PROMPT_SOURCE_MIN_TIMEOUT_SECONDS;
export const PROMPT_PRINCIPLE_SOURCE_MAX_TIMEOUT_SECONDS = PROMPT_SOURCE_MAX_TIMEOUT_SECONDS;
export const promptPrincipleSourceSchema = promptSourceSchema;
export type PromptPrincipleSource = PromptSource;
export type PromptPrincipleSourceLoadResult = PromptSourceLoadResult;
export type PromptPrincipleSourceRefreshResult = PromptSourceRefreshResult;

export const promptPrincipleSchema = z.object({
  id: z.string(),
  name: z.string(),
  text: z.string(),
  enabled: z.boolean(),
  source: promptPrincipleSourceSchema.optional(),
});

export type PromptPrinciple = z.infer<typeof promptPrincipleSchema>;

/**
 * A project's prompt-principle layer over the app-global list:
 * - `globalOverrides` maps a global principle id to an explicit enabled state
 *   for this project. Absent ids inherit the global default.
 * - `items` are project-local principles, appended after the global ones.
 */
export const projectPromptPrinciplesSchema = z.object({
  globalOverrides: z.record(z.string(), z.boolean()).optional(),
  items: z.array(promptPrincipleSchema).optional(),
});

export type ProjectPromptPrinciples = z.infer<typeof projectPromptPrinciplesSchema>;

/**
 * Per-project documentation sources surfaced by the project Docs page.
 * `localPath` is a repo-relative directory of markdown files; `cloudUrl` is a
 * deployed docs site. The page shows whichever are set and lets the user
 * switch when both exist.
 */
export const projectDocsSettingsSchema = z.object({
  localPath: z.string().optional(),
  cloudUrl: z.string().optional(),
});

export type ProjectDocsSettings = z.infer<typeof projectDocsSettingsSchema>;

export const composerRunModeValues = LEGACY_RUN_MODES;
export const composerStrategyKindValues = ['new-branch', 'no-worktree'] as const;
export const taskOutputLanguageValues = ['skip', 'app', 'prompt', 'en', 'zh-CN'] as const;
export type TaskOutputLanguage = (typeof taskOutputLanguageValues)[number];

/**
 * Whether an input-prompt language actually asks for a rewrite. Rewriting a
 * prompt into the language it is already written in is the same as not
 * rewriting, so `prompt` counts as off alongside `skip` — which is why the
 * capability needs its own switch rather than reading on/off off the language.
 */
export function isPromptRewriteEnabled(language: TaskOutputLanguage | undefined): boolean {
  return language !== undefined && language !== 'skip' && language !== 'prompt';
}

/**
 * A project's overrides for the home composer's run configuration. Every field
 * is optional: absent means "inherit the user's global homeDraft default",
 * present means "this project overrides it". Stored in project settings so it
 * can be committed to `.yoda.json` and shared across the team — the exact same
 * layering model as {@link projectPromptPrinciplesSchema}.
 */
export const composerBaseBranchSchema = z.object({
  type: z.enum(['local', 'remote']),
  branch: z.string(),
  remoteName: z.string().optional(),
});

export type ComposerBaseBranch = z.infer<typeof composerBaseBranchSchema>;

export const composerDefaultsSchema = z.object({
  runtimeId: runtimeIdSchema.optional(),
  // A retired run mode coerces to vibe coding so an old `.yoda.json` override
  // still parses instead of failing the whole settings object.
  runMode: z.preprocess(normalizeLegacyRunMode, z.enum(composerRunModeValues).optional()),
  baseBranch: composerBaseBranchSchema.optional(),
  standardStrategyKind: z.enum(composerStrategyKindValues).optional(),
  attachImagesAsPaths: z.boolean().optional(),
  inputPromptLanguage: z.enum(taskOutputLanguageValues).optional(),
  namingLanguage: z.enum(taskOutputLanguageValues).optional(),
  summaryLanguage: z.enum(taskOutputLanguageValues).optional(),
});

export type ComposerDefaults = z.infer<typeof composerDefaultsSchema>;

export const shareableProjectSettingsSchema = z.object({
  preservePatterns: preservePatternsSchema.optional(),
  shellSetup: z.string().optional(),
  scripts: shareableProjectScriptsSettingsSchema.optional(),
  quickActions: z.array(quickActionSchema).optional(),
  promptPrinciples: projectPromptPrinciplesSchema.optional(),
  composerDefaults: composerDefaultsSchema.optional(),
  docs: projectDocsSettingsSchema.optional(),
});

export const shareableProjectSettingsWithDefaultsSchema = shareableProjectSettingsSchema.extend({
  preservePatterns: preservePatternsSchema.default([...DEFAULT_PRESERVE_PATTERNS]),
});

export type ShareableProjectSettings = z.infer<typeof shareableProjectSettingsSchema>;

export const baseProjectSettingsSchema = z.object({
  worktreeDirectory: z.string().trim().optional(),
  defaultBranch: defaultBranchSettingSchema.optional(),
  remote: z.string().optional(),
  /**
   * Extra directories whose Claude session transcripts count toward this
   * project's usage stats — work done outside Yoda (research dirs, previous
   * locations after a move). Entries are matched against `~/.claude/projects`
   * by their encoded cwd, so paths that no longer exist on disk still work.
   */
  statsAuxiliaryPaths: z.array(z.string().trim()).optional(),
  workspaceProvider: z
    .object({
      type: z.literal('script'),
      provisionCommand: z.string().min(1),
      terminateCommand: z.string().min(1),
    })
    .optional(),
});

export type BaseProjectSettings = z.infer<typeof baseProjectSettingsSchema>;

export const projectSettingsSchema = baseProjectSettingsSchema.merge(
  shareableProjectSettingsSchema
);

export const legacyProjectConfigSchema = projectSettingsSchema;

export function defaultShareableProjectSettings(): ShareableProjectSettings {
  return shareableProjectSettingsWithDefaultsSchema.parse({});
}

export type ProjectSettings = z.infer<typeof projectSettingsSchema>;

export type ProjectSettingsPage = {
  settings: ProjectSettings;
  defaults: {
    worktreeDirectory: string;
  };
  writeTargets: ProjectSettingsWriteTargetOption[];
  overrideState: ProjectSettingsOverrideState;
};

export type ProjectSettingsWriteTarget =
  | { type: 'project' }
  | { type: 'task'; taskId: string }
  | { type: 'workspace'; workspaceId: string };

export type ProjectSettingsWriteTargetOption = ProjectSettingsWriteTarget & {
  label: string;
  path: string;
};

export type ShareableProjectSettingsWriteField =
  | 'preservePatterns'
  | 'shellSetup'
  | 'scripts.setup'
  | 'scripts.run'
  | 'scripts.teardown'
  | 'quickActions'
  | 'promptPrinciples'
  | 'composerDefaults'
  | 'docs.localPath'
  | 'docs.cloudUrl';

export const SHAREABLE_PROJECT_SETTINGS_WRITE_FIELDS = [
  'preservePatterns',
  'shellSetup',
  'scripts.setup',
  'scripts.run',
  'scripts.teardown',
  'quickActions',
  'promptPrinciples',
  'composerDefaults',
  'docs.localPath',
  'docs.cloudUrl',
] as const satisfies ShareableProjectSettingsWriteField[];

export type WriteProjectConfigRequest = {
  target: ProjectSettingsWriteTarget;
  fields: ShareableProjectSettingsWriteField[];
};

export type ProjectSettingsOverrideSource = {
  label: string;
  path: string;
  value: string;
};

export type ProjectSettingsOverrideState = Record<
  ShareableProjectSettingsWriteField,
  ProjectSettingsOverrideSource[]
>;

export function emptyProjectSettingsOverrideState(): ProjectSettingsOverrideState {
  return {
    preservePatterns: [],
    shellSetup: [],
    'scripts.setup': [],
    'scripts.run': [],
    'scripts.teardown': [],
    quickActions: [],
    promptPrinciples: [],
    composerDefaults: [],
    'docs.localPath': [],
    'docs.cloudUrl': [],
  };
}
