import z from 'zod';

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

export const quickActionSchema = z.object({
  id: z.string(),
  label: z.string(),
  command: z.string(),
});

export type QuickAction = z.infer<typeof quickActionSchema>;

export const shareableProjectSettingsSchema = z.object({
  preservePatterns: preservePatternsSchema.optional(),
  shellSetup: z.string().optional(),
  scripts: shareableProjectScriptsSettingsSchema.optional(),
  quickActions: z.array(quickActionSchema).optional(),
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
  | 'quickActions';

export const SHAREABLE_PROJECT_SETTINGS_WRITE_FIELDS = [
  'preservePatterns',
  'shellSetup',
  'scripts.setup',
  'scripts.run',
  'scripts.teardown',
  'quickActions',
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
  };
}
